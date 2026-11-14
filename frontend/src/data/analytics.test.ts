import { describe, expect, it } from 'vitest'
import { fixture } from '../test/pathwayFixture'
import { nationalSeries, nationalStatus } from './analytics'

describe('national analytics', () => {
  it('counts counties once when several stages have an Act signal', () => {
    const snapshot = structuredClone(fixture)
    snapshot.counties[0].stage_verdicts.detection = 'act'
    snapshot.counties[1].stage_verdicts.referral = 'verify'
    expect(nationalStatus(snapshot)).toMatchObject({ act: 1, verify: 1, classified: 2, total: 2 })
    expect(nationalStatus(snapshot).statement).toContain('1 of 2 counties')
  })

  it('distinguishes missing classifications from a snapshot with no Act signals', () => {
    const snapshot = structuredClone(fixture)
    snapshot.counties.forEach(county => { county.stage_verdicts = {} })
    expect(nationalStatus(snapshot).statement).toContain('cannot yet be assessed')
    snapshot.counties[0].stage_verdicts.detection = 'verify'
    expect(nationalStatus(snapshot).statement).toContain('1 county has data to verify')
    snapshot.counties[0].stage_verdicts.detection = 'ok'
    expect(nationalStatus(snapshot).statement).toContain('1 county with classified pathway data')
  })

  it('uses published national values, preserves zero, and omits missing or nonfinite values', () => {
    const snapshot = structuredClone(fixture)
    expect(nationalSeries(snapshot, id => id === 'scr_crc_att')[0].value.v).toBe(70)
    snapshot.national.scr_crc_att.v = 0
    expect(nationalSeries(snapshot, id => id === 'scr_crc_att')[0].value.v).toBe(0)
    snapshot.national.scr_crc_att.v = null
    snapshot.national.lung_noinfo.v = NaN
    expect(nationalSeries(snapshot, () => true)).toEqual([])
  })
})
