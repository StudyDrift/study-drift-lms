import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from './auth'
import { fetchLearningActivityReport, type LearningActivityReport } from './reportsApi'
import { server } from '../test/mocks/server'

const sampleReport: LearningActivityReport = {
  range: { from: '2026-01-01', to: '2026-01-31' },
  summary: { totalEvents: 1, uniqueUsers: 1, uniqueCourses: 1 },
  byDay: [{ day: '2026-01-15', courseVisit: 1, contentOpen: 0, contentLeave: 0 }],
  byEventKind: [{ eventKind: 'course.visit', count: 1 }],
  topCourses: [
    { courseId: 'c1', courseCode: 'C-1', title: 'T', eventCount: 1 },
  ],
}

describe('fetchLearningActivityReport', () => {
  beforeEach(() => {
    setAccessToken('test-token')
    server.use(
      http.get('http://localhost:8080/api/v1/reports/learning-activity', ({ request }) => {
        const u = new URL(request.url)
        expect(u.searchParams.get('from')).toBe('2026-02-01')
        expect(u.searchParams.get('to')).toBe('2026-02-28')
        return HttpResponse.json(sampleReport)
      }),
    )
  })

  it('passes query params and parses JSON', async () => {
    const r = await fetchLearningActivityReport({ from: '2026-02-01', to: '2026-02-28' })
    expect(r.summary.totalEvents).toBe(1)
    expect(r.topCourses[0]!.courseCode).toBe('C-1')
  })
})
