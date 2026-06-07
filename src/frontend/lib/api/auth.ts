import type { AuthResult, AuthStatus } from '../types'
import { request, requestPublic } from './client'

export const authApi = {
  status: () => requestPublic<AuthStatus>('/api/auth/status'),
  login: (email: string, password: string) =>
    requestPublic<AuthResult>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (email: string, password: string) =>
    requestPublic<AuthResult>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<{ status: string }>('/api/auth/logout', { method: 'POST' }),
}
