import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { AppError } from '../src/lib/errors.js'
import {
  APPLICATION_ACTIONS, EMPLOYER_ACTIONS, JOB_ACTIONS, MATCH_WEIGHTS, assertOpeningAvailable, computeMatchScore, isApplicationOpen, isInterviewLive, isJobEditable, isJobOpenForApplications,
  parseSkillList, planApplicationTransition, planEmployerTransition, planInterviewTransition, planJobTransition, planPlacementTransition, validateInterview, validateJobForPublish,
  validatePlacement, validateSalary, type ApplicationAction, type ApplicationStatus, type EmployerStatus, type JobStatus,
} from '../src/modules/employment/employment.rules.js'

const status = (fn: () => unknown) => { try { fn() } catch (e) { return (e as AppError).statusCode } return 0 }
const paths = (fn: () => unknown): string[] => { try { fn() } catch (e) { return ((e as AppError).details as { issues: Array<{ path: string }> }).issues.map((i) => i.path) } return [] }
const TODAY = '2026-09-29'
const NOW = new Date('2026-09-29T10:00:00Z')

describe('employer verification', () => {
  test('happy paths', () => {
    assert.equal(planEmployerTransition('pending', 'verify').to, 'verified'); assert.equal(planEmployerTransition('unverified', 'verify').to, 'verified')
    assert.equal(planEmployerTransition('verified', 'suspend', 'Fraud report').to, 'suspended'); assert.equal(planEmployerTransition('suspended', 'reinstate').to, 'verified')
    assert.equal(planEmployerTransition('rejected', 'reopen').to, 'pending')
  })
  test('reject and suspend need a real reason (422); missing reason is not silently accepted', () => {
    assert.equal(status(() => planEmployerTransition('pending', 'reject')), 422); assert.equal(status(() => planEmployerTransition('pending', 'reject', ' ab ')), 422)
    assert.equal(status(() => planEmployerTransition('verified', 'suspend', '')), 422)
    assert.equal(planEmployerTransition('pending', 'reject', '  Documents do not match ').reason, 'Documents do not match')
  })
  test('every action from every wrong status is 409', () => {
    const all: EmployerStatus[] = ['unverified', 'pending', 'verified', 'rejected', 'suspended']
    const ok: Record<string, EmployerStatus[]> = { verify: ['unverified', 'pending'], reject: ['unverified', 'pending'], suspend: ['verified'], reinstate: ['suspended'], reopen: ['rejected'] }
    for (const a of EMPLOYER_ACTIONS) for (const s of all) if (!ok[a]!.includes(s)) assert.equal(status(() => planEmployerTransition(s, a, 'a reason')), 409, `${a} from ${s}`)
  })
  test('an unknown action is a 400', () => { assert.equal(status(() => planEmployerTransition('pending', 'explode' as never)), 400) })
})

describe('job lifecycle', () => {
  test('publish and resume need a verified employer; pause and close do not', () => {
    assert.equal(planJobTransition('draft', 'publish', 'verified'), 'active'); assert.equal(planJobTransition('paused', 'resume', 'verified'), 'active')
    for (const s of ['pending', 'rejected', 'suspended', 'unverified']) { assert.equal(status(() => planJobTransition('draft', 'publish', s)), 409); assert.equal(status(() => planJobTransition('paused', 'resume', s)), 409) }
    assert.equal(planJobTransition('active', 'pause', 'suspended'), 'paused'); assert.equal(planJobTransition('active', 'close', 'suspended'), 'closed')
  })
  test('EMPLOYER_NOT_VERIFIED is a machine-readable code', () => {
    try { planJobTransition('draft', 'publish', 'pending') } catch (e) { assert.equal(((e as AppError).details as { code: string }).code, 'EMPLOYER_NOT_VERIFIED') }
  })
  test('closed is final; draft cannot pause; active cannot publish again', () => {
    for (const a of JOB_ACTIONS) assert.equal(status(() => planJobTransition('closed', a, 'verified')), 409, a)
    assert.equal(status(() => planJobTransition('draft', 'pause', 'verified')), 409); assert.equal(status(() => planJobTransition('active', 'publish', 'verified')), 409)
    assert.equal(planJobTransition('draft', 'close', 'verified'), 'closed'); assert.equal(planJobTransition('paused', 'close', 'verified'), 'closed')
  })
  test('editability and discovery', () => {
    assert.deepEqual((['draft', 'active', 'paused', 'closed'] as JobStatus[]).map(isJobEditable), [true, true, true, false])
    const j = { status: 'active', deadline: null as string | null, employerStatus: 'verified' }
    assert.equal(isJobOpenForApplications(j, TODAY), true)
    assert.equal(isJobOpenForApplications({ ...j, deadline: TODAY }, TODAY), true)            // last day still open
    assert.equal(isJobOpenForApplications({ ...j, deadline: '2026-09-28' }, TODAY), false)
    assert.equal(isJobOpenForApplications({ ...j, employerStatus: 'suspended' }, TODAY), false)
    assert.equal(isJobOpenForApplications({ ...j, status: 'paused' }, TODAY), false)
  })
  test('publish validation reports every problem together', () => {
    assert.deepEqual(paths(() => validateJobForPublish({ title: 'ab', description: 'short', openings: 0, deadline: '2026-01-01' }, TODAY)).sort(), ['deadline', 'description', 'location', 'openings', 'title'])
    assert.equal(status(() => validateJobForPublish({ title: 'Solar installer', description: 'Install and maintain rooftop solar systems.', openings: 2, location: 'Raipur' }, TODAY)), 0)
    assert.equal(status(() => validateJobForPublish({ title: 'Data entry', description: 'Enter cooperative records remotely.', openings: 1, workMode: 'Remote' }, TODAY)), 0)   // remote needs no location
    assert.deepEqual(paths(() => validateJobForPublish({ title: 'Solar installer', description: 'Install and maintain rooftop solar.', openings: 1, location: 'Raipur', deadline: '2026-02-30' }, TODAY)), ['deadline'])
  })
  test('salary range', () => {
    assert.equal(status(() => validateSalary(100, 200)), 0); assert.equal(status(() => validateSalary(null, 200)), 0); assert.equal(status(() => validateSalary()), 0)
    assert.deepEqual(paths(() => validateSalary(200, 100)), ['salaryMax']); assert.deepEqual(paths(() => validateSalary(-1, 5)), ['salaryMin']); assert.deepEqual(paths(() => validateSalary(1, Number.NaN)), ['salaryMax'])
  })
})

describe('application stages', () => {
  test('one step at a time along the pipeline', () => {
    let s: ApplicationStatus = 'review'
    for (const [a, to] of [['shortlist', 'shortlisted'], ['interview', 'interview'], ['offer', 'offer'], ['place', 'placed']] as Array<[ApplicationAction, ApplicationStatus]>) { s = planApplicationTransition(s, a, 'employer').to; assert.equal(s, to) }
  })
  test('no skipping: review cannot go straight to offer or placed; shortlisted cannot be offered', () => {
    assert.equal(status(() => planApplicationTransition('review', 'offer', 'employer')), 409); assert.equal(status(() => planApplicationTransition('review', 'place', 'employer')), 409)
    assert.equal(status(() => planApplicationTransition('shortlisted', 'offer', 'employer')), 409); assert.equal(status(() => planApplicationTransition('review', 'interview', 'employer')), 409)
  })
  test('reject needs a reason from any open stage; withdraw is the trainee only', () => {
    for (const s of ['review', 'shortlisted', 'interview', 'offer'] as ApplicationStatus[]) {
      assert.equal(status(() => planApplicationTransition(s, 'reject', 'employer')), 422); assert.equal(planApplicationTransition(s, 'reject', 'employer', 'Not a fit').to, 'rejected')
      assert.equal(planApplicationTransition(s, 'withdraw', 'trainee').to, 'withdrawn')
    }
    assert.equal(status(() => planApplicationTransition('review', 'withdraw', 'employer')), 403)
    for (const a of ['shortlist', 'interview', 'offer', 'place', 'reject'] as ApplicationAction[]) assert.equal(status(() => planApplicationTransition('review', a, 'trainee', 'reason')), 403, `trainee must not ${a}`)
  })
  test('placed, rejected and withdrawn are final for every action', () => {
    for (const s of ['placed', 'rejected', 'withdrawn'] as ApplicationStatus[]) {
      assert.equal(isApplicationOpen(s), false)
      for (const a of APPLICATION_ACTIONS) assert.equal(status(() => planApplicationTransition(s, a, a === 'withdraw' ? 'trainee' : 'employer', 'a reason')), 409, `${a} from ${s}`)
    }
  })
})

describe('interviews', () => {
  const ok = { scheduledAt: new Date('2026-10-05T09:00:00Z'), mode: 'video' as const, locationOrLink: 'https://meet.example.org/abc' }
  test('valid schedules', () => {
    assert.equal(status(() => validateInterview(ok, NOW)), 0)
    assert.equal(status(() => validateInterview({ ...ok, mode: 'phone', locationOrLink: null }, NOW)), 0)
    assert.equal(status(() => validateInterview({ ...ok, mode: 'in_person', locationOrLink: 'Block office, Durg' }, NOW)), 0)
  })
  test('past, invalid and far-future times are refused', () => {
    assert.deepEqual(paths(() => validateInterview({ ...ok, scheduledAt: new Date('2026-09-29T09:59:59Z') }, NOW)), ['scheduledAt'])
    assert.deepEqual(paths(() => validateInterview({ ...ok, scheduledAt: new Date('nope') }, NOW)), ['scheduledAt'])
    assert.deepEqual(paths(() => validateInterview({ ...ok, scheduledAt: new Date('2028-01-01T00:00:00Z') }, NOW)), ['scheduledAt'])
  })
  test('video needs an http(s) link, in-person needs an address', () => {
    assert.deepEqual(paths(() => validateInterview({ ...ok, locationOrLink: '' }, NOW)), ['locationOrLink'])
    assert.deepEqual(paths(() => validateInterview({ ...ok, locationOrLink: 'javascript:alert(1)' }, NOW)), ['locationOrLink'])
    assert.deepEqual(paths(() => validateInterview({ ...ok, locationOrLink: 'meet me' }, NOW)), ['locationOrLink'])
    assert.deepEqual(paths(() => validateInterview({ ...ok, mode: 'in_person', locationOrLink: '  ' }, NOW)), ['locationOrLink'])
  })
  test('status machine: live -> outcomes, outcomes final', () => {
    assert.equal(planInterviewTransition('scheduled', 'confirmed'), 'confirmed'); assert.equal(planInterviewTransition('confirmed', 'completed'), 'completed'); assert.equal(planInterviewTransition('scheduled', 'no_show'), 'no_show')
    for (const s of ['completed', 'cancelled', 'no_show'] as const) assert.equal(status(() => planInterviewTransition(s, 'confirmed')), 409)
    assert.equal(status(() => planInterviewTransition('confirmed', 'scheduled')), 409)
    assert.deepEqual(['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'].map(isInterviewLive), [true, true, false, false, false])
  })
})

describe('placements', () => {
  test('status machine', () => {
    assert.equal(planPlacementTransition('confirmed', 'joined'), 'joined'); assert.equal(planPlacementTransition('confirmed', 'not_joined'), 'not_joined'); assert.equal(planPlacementTransition('joined', 'left'), 'left')
    for (const [a, b] of [['confirmed', 'left'], ['joined', 'not_joined'], ['left', 'joined'], ['not_joined', 'joined'], ['joined', 'confirmed']] as const) assert.equal(status(() => planPlacementTransition(a, b)), 409, `${a}->${b}`)
  })
  test('validation', () => {
    assert.equal(status(() => validatePlacement({})), 0); assert.equal(status(() => validatePlacement({ joiningDate: '2026-11-01', salaryOffered: 250000 })), 0)
    assert.deepEqual(paths(() => validatePlacement({ joiningDate: '2026-02-30', salaryOffered: -5 })).sort(), ['joiningDate', 'salaryOffered'])
  })
  test('openings cap', () => {
    assert.equal(status(() => assertOpeningAvailable(2, 1)), 0)
    try { assertOpeningAvailable(2, 2) } catch (e) { assert.equal((e as AppError).statusCode, 409); assert.equal(((e as AppError).details as { code: string }).code, 'OPENINGS_FILLED') }
    assert.equal(status(() => assertOpeningAvailable(1, 5)), 409)
  })
})

describe('match score', () => {
  const trainee = { skills: ['Solar Wiring', 'pv design', 'Safety'], location: 'Durg', district: 'Durg', state: 'Chhattisgarh' }
  const job = { requiredSkills: 'solar wiring, PV design', preferredSkills: 'safety; first aid', jobLocation: 'Durg, Chhattisgarh', workMode: 'On-site' }
  test('weights add up to 100', () => { assert.equal(MATCH_WEIGHTS.requiredSkills + MATCH_WEIGHTS.preferredSkills + MATCH_WEIGHTS.location + MATCH_WEIGHTS.certification, 100); assert.equal(MATCH_WEIGHTS.skillsOnly, MATCH_WEIGHTS.requiredSkills + MATCH_WEIGHTS.preferredSkills) })
  test('skill parsing: separators, case, spacing, duplicates, caps', () => {
    assert.deepEqual(parseSkillList('Solar  Wiring, PV design;Safety\nfirst|solar wiring'), ['solar wiring', 'pv design', 'safety', 'first'])
    assert.deepEqual(parseSkillList(['  A ', 'a', '', 'B']), ['a', 'b']); assert.deepEqual(parseSkillList(null), []); assert.deepEqual(parseSkillList('x'.repeat(61)), [])
    assert.equal(parseSkillList(Array.from({ length: 80 }, (_, i) => `s${i}`)).length, 50)
  })
  test('full required match, half of preferred, right place, certificate: 45 + 7.5 + 20 + 20 = 92.5', () => {
    const r = computeMatchScore({ ...job, trainee, hasLiveCertificate: true })
    assert.equal(r.score, 92.5); assert.deepEqual(r.breakdown, { skills: 52.5, location: 20, certification: 20, matchedRequired: ['solar wiring', 'pv design'], missingRequired: [], matchedPreferred: ['safety'] })
  })
  test('no overlap, wrong place, no certificate is 0', () => {
    assert.equal(computeMatchScore({ requiredSkills: 'welding', jobLocation: 'Kochi', trainee, hasLiveCertificate: false }).score, 0)
  })
  test('half of the required skills, one list only, uses the full 60', () => {
    const r = computeMatchScore({ requiredSkills: 'solar wiring, welding', jobLocation: 'Kochi', trainee: { skills: ['solar wiring'] }, hasLiveCertificate: false })
    assert.equal(r.score, 30); assert.deepEqual(r.breakdown.missingRequired, ['welding'])
    assert.equal(computeMatchScore({ preferredSkills: 'a, b, c, d', jobLocation: 'Kochi', trainee: { skills: ['a'] }, hasLiveCertificate: false }).score, 15)
  })
  test('a job that lists no skills is neutral (30), and no location is neutral (10)', () => {
    assert.equal(computeMatchScore({ trainee: { skills: [] }, hasLiveCertificate: false }).score, 40)
  })
  test('remote work always earns the location points; place matching uses location, district or state, whole-entry and case-insensitive', () => {
    assert.equal(computeMatchScore({ requiredSkills: 'x', workMode: 'Remote', trainee: { skills: [] }, hasLiveCertificate: false }).breakdown.location, 20)
    assert.equal(computeMatchScore({ requiredSkills: 'x', jobLocation: 'CHHATTISGARH (field)', trainee: { skills: [], state: 'chhattisgarh' }, hasLiveCertificate: false }).breakdown.location, 20)
    assert.equal(computeMatchScore({ requiredSkills: 'x', jobLocation: 'Raipur', trainee: { skills: [], district: 'Durg' }, hasLiveCertificate: false }).breakdown.location, 0)
    assert.equal(computeMatchScore({ requiredSkills: 'x', jobLocation: 'Raipur', trainee: { skills: [], location: 'ab' }, hasLiveCertificate: false }).breakdown.location, 0)   // too short to match on
  })
  test('score is always within 0..100 with two decimals', () => {
    for (let i = 0; i < 200; i++) {
      const skills = Array.from({ length: i % 7 }, (_, k) => `s${k}`)
      const r = computeMatchScore({ requiredSkills: 's0,s1,s2', preferredSkills: 's3,s4', jobLocation: i % 2 ? 'Durg' : null, workMode: i % 3 ? 'Remote' : null, trainee: { skills, location: 'Durg' }, hasLiveCertificate: i % 2 === 0 })
      assert.ok(r.score >= 0 && r.score <= 100 && Math.round(r.score * 100) === r.score * 100)
    }
  })
  test('matching is exact on whole entries: "solar" does not match "solar wiring"', () => {
    assert.equal(computeMatchScore({ requiredSkills: 'solar', jobLocation: 'Kochi', trainee: { skills: ['solar wiring'] }, hasLiveCertificate: false }).breakdown.matchedRequired.length, 0)
  })
})
