// Copies the generated pathway snapshot into the frontend bundle for offline use.
// Usage: npm run snapshot            (copy ../data/processed/pathway_snapshot.json)
//        npm run snapshot -- --placeholder   (rebuild the lung-only placeholder)
// When the generated file is missing, the existing bundled snapshot is kept; if no
// bundled snapshot exists either, a lung-only placeholder is built from
// src/data/countyLungTreatment.json so the app always has a valid offline fallback.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, '../data/processed/pathway_snapshot.json')
const target = resolve(root, 'src/data/pathway_snapshot.json')
const lung = resolve(root, 'src/data/countyLungTreatment.json')

function validate(snapshot) {
  const problems = []
  for (const key of ['stages', 'indicators', 'counties']) if (!Array.isArray(snapshot[key])) problems.push(`${key} must be an array`)
  for (const key of ['national', 'verdicts']) if (typeof snapshot[key] !== 'object' || snapshot[key] === null) problems.push(`${key} must be an object`)
  for (const county of snapshot.counties ?? []) if (!/^HVA\d{2}$/.test(county.code)) problems.push(`invalid county code ${county.code}`)
  return problems
}

function wilson(k, n) {
  const z = 1.96, p = k / n, den = 1 + z * z / n
  const centre = (p + z * z / (2 * n)) / den
  const half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
  return [100 * (centre - half), 100 * (centre + half)]
}
const round = value => Math.round(value * 10) / 10
const fmt = value => new Intl.NumberFormat('en').format(value)

function placeholder() {
  const data = JSON.parse(readFileSync(lung, 'utf8'))
  const reporting = data.regions.filter(r => r.patients)
  const patients = reporting.reduce((s, r) => s + r.patients, 0)
  const missing = reporting.reduce((s, r) => s + r.missing, 0)
  const national = round(100 * missing / patients)
  const shares = reporting.map(r => r.share)
  const rec = data.recommendation
  const stages = [
    { id: 'detection', label: 'Detection', hint: 'Screening participation and early detection' },
    { id: 'followup', label: 'Follow-up', hint: 'Follow-up of positive screening results' },
    { id: 'referral', label: 'Referral', hint: 'Primary to specialist care; proxies only, no national referral-delay series' },
    { id: 'diagnosis', label: 'Diagnosis & records', hint: 'Staging, MDT discussion and record completeness' },
    { id: 'treatment', label: 'Treatment', hint: 'Recorded treatment within the observation window' },
    { id: 'outcome', label: 'Outcome', hint: 'Survival and mortality' },
  ]
  const verdictFor = (v, lo, hi) => lo > national ? 'act' : hi < national ? 'ok' : v > national ? 'monitor' : 'ok'
  return {
    built: new Date().toISOString().slice(0, 19),
    placeholder: true,
    national_headline: `${fmt(missing)} of ${fmt(patients)} lung cancer patients (${national}%) have no recorded treatment — ${Math.min(...shares)}% to ${Math.max(...shares)}% by county. Click a county for actions.`,
    stages,
    indicators: [{
      id: 'lung_noinfo', label: 'Lung cancer patients without a treatment record', short: 'No treatment record',
      stage: 'treatment', unit: '%', polarity: 'lower_better', kind: 'share', period: data.period,
      source_url: data.sourceUrl, is_proxy: false,
    }],
    national: { lung_noinfo: { v: national, lo: null, hi: null, n: missing, d: patients } },
    verdicts: {
      act: { label: 'Act', desc: 'Interval clearly worse than the national comparator' },
      verify: { label: 'Verify data', desc: 'Signal present but recording or coverage needs checking first' },
      monitor: { label: 'Monitor', desc: 'Worse than the comparator but within uncertainty' },
      ok: { label: 'In line', desc: 'In line with or better than the national comparator' },
      nodata: { label: 'No data', desc: 'No published estimate for this area' },
    },
    counties: data.regions.map(r => {
      const empty = Object.fromEntries(stages.map(s => [s.id, 'nodata']))
      if (!r.patients) return { code: r.regionId, name: r.regionName, headline: `${r.regionName} has no published lung treatment estimate.`, stage_verdicts: empty, values: {}, actions: [] }
      const [lo, hi] = wilson(r.missing, r.patients)
      const verdict = verdictFor(r.share, lo, hi)
      const excess = Math.max(0, Math.round(r.missing - r.patients * national / 100))
      return {
        code: r.regionId, name: r.regionName,
        headline: `${fmt(r.missing)} of ${fmt(r.patients)} lung cancer patients (${r.share}%) have no recorded treatment, against ${national}% nationally.`,
        stage_verdicts: { ...empty, treatment: verdict },
        values: { lung_noinfo: { v: r.share, lo: round(lo), hi: round(hi), n: r.missing, d: r.patients, comparator: national, verdict } },
        actions: verdict === 'act' || verdict === 'monitor' ? [{
          playbook_id: rec.id, title: 'Close lung cancer treatment-record gaps', pathway_stage: 'treatment', owner: rec.owner,
          baseline: `${r.share}% without a treatment record (${fmt(r.missing)} of ${fmt(r.patients)}, ${data.period})`,
          target: `At or below the national ${national}% (about ${fmt(excess)} fewer unrecorded patients over five years)`,
          annual_volume: `About ${fmt(Math.round(r.patients / 5))} lung cancer diagnoses a year`,
          timeline: '90-day review, then quarterly monitoring',
          first_90_days: ['Pull the list of patients without a treatment record for the latest diagnosis year', 'Reconcile against oncology, surgery and palliative care records', 'Report corrected records to the Finnish Cancer Registry'],
          concrete_steps: [rec.proposal, `Track: ${rec.measure.join('; ')}`],
          escalation: 'If the share is still above the national rate after reconciliation, escalate to a clinical pathway review of untreated patients',
          citations: [{ label: 'Finnish Cancer Registry lung cancer quality report', url: data.sourceUrl }, { label: `National cancer strategy implementation roadmap 2026–2031, action ${rec.evidence[1]?.action ?? '3.2.1'} (PDF p. ${rec.evidence[1]?.pdf_page ?? 60})`, url: '' }],
        }] : [],
      }
    }),
  }
}

const forcePlaceholder = process.argv.includes('--placeholder')
if (!forcePlaceholder && existsSync(source)) {
  const snapshot = JSON.parse(readFileSync(source, 'utf8'))
  const problems = validate(snapshot)
  if (problems.length) {
    console.error(`Not copying ${source}:\n- ${problems.join('\n- ')}`)
    process.exit(1)
  }
  writeFileSync(target, JSON.stringify(snapshot))
  console.log(`Copied pathway snapshot (${snapshot.indicators.length} indicators, ${snapshot.counties.length} areas) to src/data/pathway_snapshot.json`)
} else if (!forcePlaceholder && existsSync(target)) {
  console.warn(`${source} not found; keeping the existing bundled snapshot`)
} else {
  writeFileSync(target, JSON.stringify(placeholder(), null, 1) + '\n')
  console.warn(`Wrote a lung-only placeholder to src/data/pathway_snapshot.json${forcePlaceholder ? '' : ` (${source} not found)`}`)
}
