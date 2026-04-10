import { http, HttpResponse } from 'msw'

const mockUserId = '00000000-0000-0000-0000-000000000001'

/**
 * Default happy-path handlers. Override per test with server.use(...) for TDD (errors, edge cases).
 */
export const handlers = [
  http.post('http://localhost:8080/api/v1/courses', async () => {
    return HttpResponse.json({
      id: '00000000-0000-0000-0000-000000000099',
      courseCode: 'C-TEST01',
      title: 'Test course',
      description: '',
      heroImageUrl: null,
      heroImageObjectPosition: null,
      startsAt: null,
      endsAt: null,
      visibleFrom: null,
      hiddenAt: null,
      scheduleMode: 'fixed',
      relativeEndAfter: null,
      relativeHiddenAfter: null,
      relativeScheduleAnchorAt: null,
      published: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  }),
  http.get('http://localhost:8080/api/v1/me/permissions', () => {
    return HttpResponse.json({
      permissionStrings: ['global:app:rbac:manage'],
    })
  }),
  http.get('http://localhost:8080/api/v1/search', () => {
    return HttpResponse.json({
      courses: [],
      people: [],
    })
  }),
  http.post('http://localhost:8080/api/v1/auth/login', async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string }
    return HttpResponse.json({
      access_token: 'mock-access-token',
      token_type: 'Bearer',
      user: {
        id: mockUserId,
        email: body.email,
        displayName: null as string | null,
        firstName: null as string | null,
        lastName: null as string | null,
        avatarUrl: null as string | null,
        uiTheme: 'light',
      },
    })
  }),
  http.get('http://localhost:8080/api/v1/settings/roles/:roleId/users', () => {
    return HttpResponse.json({ users: [] })
  }),
  http.get('http://localhost:8080/api/v1/settings/roles/:roleId/users/eligible', () => {
    return HttpResponse.json({ users: [] })
  }),
  http.post('http://localhost:8080/api/v1/settings/roles/:roleId/users', () => {
    return new HttpResponse(null, { status: 204 })
  }),
  http.delete('http://localhost:8080/api/v1/settings/roles/:roleId/users/:userId', () => {
    return new HttpResponse(null, { status: 204 })
  }),
  http.post('http://localhost:8080/api/v1/auth/signup', async ({ request }) => {
    const body = (await request.json()) as {
      email: string
      password: string
      display_name?: string
    }
    const displayName = body.display_name?.trim() || null
    return HttpResponse.json({
      access_token: 'mock-access-token',
      token_type: 'Bearer',
      user: {
        id: mockUserId,
        email: body.email,
        displayName,
        firstName: null as string | null,
        lastName: null as string | null,
        avatarUrl: null as string | null,
        uiTheme: 'light',
      },
    })
  }),
]
