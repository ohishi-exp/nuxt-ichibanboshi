/**
 * サーバーサイド認証ミドルウェア
 *
 * logi_auth_token cookie がなければ auth-worker のログイン画面へ 302 リダイレクト。
 * HTML 描画前にリダイレクトするため、未認証時にページが一瞬見えるのを防ぐ。
 */

import { checkTenantId, getParentDomainFromHost, resolveAuthAction } from '../utils/auth-logic'

export default defineEventHandler((event) => {
  const config = useRuntimeConfig()

  const url = getRequestURL(event)
  const cookie = getCookie(event, 'logi_auth_token')

  const cookieOpts = (domain: string | undefined) => ({
    domain,
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
    secure: true,
    sameSite: 'lax' as const,
  })

  const tenantCheck = checkTenantId(cookie, config.allowedTenantId as string)
  if (tenantCheck.type === 'forbidden') {
    const domain = getParentDomainFromHost(url.hostname)
    setCookie(event, 'logi_auth_token', '', { ...cookieOpts(domain), maxAge: 0 })
    setCookie(event, 'lw_domain', '', { ...cookieOpts(domain), maxAge: 0 })

    const authWorkerUrl = config.public.authWorkerUrl as string
    if (authWorkerUrl) {
      const loginParams = new URLSearchParams({
        redirect_uri: `${authWorkerUrl}/top`,
        error: 'このアカウントは一番星にアクセスできません',
      })
      const loginUrl = `${authWorkerUrl}/login?${loginParams.toString()}`
      const logoutUrl = `${authWorkerUrl}/logout?redirect_uri=${encodeURIComponent(loginUrl)}`
      return sendRedirect(event, logoutUrl)
    }
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
