import Taro from '@tarojs/taro'
import { localDataEpoch, requireLocalDataEpoch } from '../store/dataEpoch'

const TOKEN_KEY = 'pindou.session.token'
// Server sessions live 48h; refresh 2h early so an active session never
// lands on an expired token mid-conversion.
const TOKEN_TTL = 46 * 3600 * 1000

let token: string | undefined
let expiry = 0

export function getSessionToken(): string | undefined {
  if (token && Date.now() < expiry) return token
  try {
    const cachedToken = Taro.getStorageSync(TOKEN_KEY)
    const cachedExpiry = Number(Taro.getStorageSync(`${TOKEN_KEY}.expiry`))
    if (cachedToken && cachedExpiry > Date.now()) {
      token = cachedToken
      expiry = cachedExpiry
    }
  } catch { /* */ }
  return token && Date.now() < expiry ? token : undefined
}

/** Drop an expired or invalid token and request a fresh silent login. */
export function invalidateSession() {
  token = undefined
  expiry = 0
  try {
    Taro.removeStorageSync(TOKEN_KEY)
    Taro.removeStorageSync(`${TOKEN_KEY}.expiry`)
  } catch { /* */ }
}

/** Silent wx.login -> backend jscode2session -> server-issued token. No UI. */
export async function ensureSession(): Promise<string> {
  const generation = localDataEpoch()
  const cached = getSessionToken()
  if (cached) return cached

  const { code } = await Taro.login()
  requireLocalDataEpoch(generation)
  const baseUrl = (process.env.TARO_APP_API_BASE_URL || '').trim().replace(/\/$/, '')
  if (!baseUrl) throw new Error('服务地址尚未配置')

  const res = await Taro.request({
    url: `${baseUrl}/api/auth/login`,
    method: 'POST',
    data: { code },
    // Allow the configured 65s cold start, WeChat exchange, and network overhead.
    timeout: 100000,
  })
  if (res.statusCode < 200 || res.statusCode >= 300 || !res.data?.token)
    throw new Error(res.data?.detail || '登录失败')

  requireLocalDataEpoch(generation)
  const freshToken = String(res.data.token)
  token = freshToken
  expiry = Date.now() + TOKEN_TTL
  try {
    Taro.setStorageSync(TOKEN_KEY, token)
    Taro.setStorageSync(`${TOKEN_KEY}.expiry`, expiry)
  } catch { /* */ }
  return freshToken
}
