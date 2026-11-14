import { asVerdict, type PathwaySnapshot } from './pathway'

export function nationalStatus(snapshot: PathwaySnapshot) {
  const statuses = snapshot.counties.map(county => snapshot.stages.map(stage => asVerdict(county.stage_verdicts[stage.id])))
  const act = statuses.filter(values => values.includes('act')).length
  const verify = statuses.filter(values => values.includes('verify')).length
  const classified = statuses.filter(values => values.some(value => value !== 'nodata')).length
  const total = snapshot.counties.length
  const statement = !classified
    ? 'County classifications are unavailable, so the overall status of cancer care cannot yet be assessed.'
    : act > 0
      ? `Cancer care remains uneven: ${act} of ${total} counties have at least one Act signal.`
      : verify > 0
        ? `No county has an Act signal in this snapshot; ${verify} ${verify === 1 ? 'county has' : 'counties have'} data to verify.`
        : `No Act or Verify signals appear among the ${classified} ${classified === 1 ? 'county' : 'counties'} with classified pathway data. Continue monitoring the available indicators.`
  return { act, verify, classified, total, statement }
}

export function nationalSeries(snapshot: PathwaySnapshot, matches: (id: string) => boolean) {
  return snapshot.indicators.filter(indicator => matches(indicator.id)).flatMap(indicator => {
    const value = snapshot.national[indicator.id]
    return value?.v != null && Number.isFinite(value.v) ? [{ indicator, value: { ...value, v: value.v } }] : []
  })
}
