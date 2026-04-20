/**
 * サーバーサイド認証ミドルウェア
 *
 * logi_auth_token cookie がなければ auth-worker のログイン画面へ 302 リダイレクト。
 * HTML 描画前にリダイレクトするため、未認証時にページが一瞬見えるのを防ぐ。
 */

import { checkTenantId, resolveAuthAction } from '../utils/auth-logic'

export default defineEventHandler((event) => {
  const config = useRuntimeConfig()

  const url = getRequestURL(event)
  const cookie = getCookie(event, 'logi_auth_token')

  const tenantCheck = checkTenantId(cookie, config.allowedTenantId as string)
  if (tenantCheck.type === 'forbidden') {
    throw createError({
      statusCode: 403,
      statusMessage: 'このアカウントではアクセスできません',
    })
  }

  const action = resolveAuthAction(
    {
      apiBackend: config.public.apiBackend as string,
      authWorkerUrl: config.public.authWorkerUrl as string,
    },
    {
      pathname: url.pathname,
      origin: url.origin,
      hostname: url.hostname,
      searchParams: url.searchParams,
      cookie,
      lwDomainCookie: getCookie(event, 'lw_domain'),
    },
  )

  const cookieOpts = (domain: string | undefined) => ({
    domain,
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
    secure: true,
    sameSite: 'lax' as const,
  })

  switch (action.type) {
    case 'pass':
      return
    case 'set-cookie-and-pass':
      setCookie(event, action.name, action.value, cookieOpts(action.domain))
      return
    case 'set-cookie-and-redirect':
      setCookie(event, action.name, action.value, cookieOpts(action.domain))
      return sendRedirect(event, action.redirectUrl)
    case 'redirect':
      return sendRedirect(event, action.redirectUrl)
  }
})
