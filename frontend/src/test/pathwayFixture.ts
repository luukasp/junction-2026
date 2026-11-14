import type { PathwaySnapshot } from '../data/pathway'

export const fixture: PathwaySnapshot = {
  built: '2026-11-14T10:00:00',
  national_headline: '3,795 of 14,183 lung cancer patients (26.8%) have no recorded treatment — 16.4% to 43.1% by county. Click a county for actions.',
  stages: [
    { id: 'detection', label: 'Detection', hint: 'Screening' },
    { id: 'referral', label: 'Referral', hint: 'Proxies only' },
    { id: 'treatment', label: 'Treatment', hint: 'Recorded treatment' },
  ],
  indicators: [
    { id: 'scr_crc_att', label: 'Bowel screening attendance', short: 'Bowel screening', stage: 'detection', unit: '%', polarity: 'higher_better', kind: 'share', period: '2024', source_url: 'https://example.org/screening', is_proxy: false },
    { id: 'lung_noinfo', label: 'Lung cancer patients without a treatment record', short: 'No treatment record', stage: 'treatment', unit: '%', polarity: 'lower_better', kind: 'share', period: '2019-2023', source_url: 'https://example.org/lung', is_proxy: false },
  ],
  national: { scr_crc_att: { v: 70 }, lung_noinfo: { v: 26.8, n: 3795, d: 14183 } },
  verdicts: { act: { label: 'Act now', desc: 'Clearly worse' }, ok: { label: 'OK', desc: 'In line' } },
  counties: [
    {
      code: 'HVA05', name: 'Southwest Finland', headline: '619 of 1,437 lung cancer patients have no recorded treatment.',
      stage_verdicts: { detection: 'ok', referral: 'nodata', treatment: 'act' },
      values: {
        scr_crc_att: { v: 72.5, lo: 71, hi: 74, verdict: 'ok' },
        lung_noinfo: { v: 43.1, lo: 40.5, hi: 45.7, n: 619, d: 1437, comparator: 26.8, verdict: 'act' },
      },
      actions: [{
        playbook_id: 'stage_mdt_completeness', title: 'Close lung treatment-record gaps', pathway_stage: 'treatment', owner: 'County oncology lead',
        baseline: '43.1% without a record', target: 'At or below 26.8%', annual_volume: 'About 287 diagnoses a year', timeline: '90 days',
        first_90_days: ['Pull the unrecorded patient list'], concrete_steps: ['Standardise registry delivery'], escalation: 'Clinical pathway review',
        citations: [{ label: 'Lung quality report', url: 'https://example.org/lung' }, { label: 'Strategy roadmap 3.2.1' }],
      }],
    },
    { code: 'HVA10', name: 'Kymenlaakso', headline: 'In line nationally.', stage_verdicts: { detection: 'monitor', treatment: 'ok' }, values: { lung_noinfo: { v: 16.4, n: 97, d: 591, verdict: 'ok' } }, actions: [] },
  ],
}
