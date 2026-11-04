/**
 * Fork-only: Settings → nanoMuse Cloud, the server row and picker. The phone's "Use a
 * different server" sheet is the model: an address, a Check against the relay's health
 * route, and "Use this server" only once the address on screen is the one that passed.
 * The desktop signs out when the choice is saved, not when the picker opens: the
 * settings page would unmount on sign-out and take the picker with it. A saved choice
 * takes effect on the next start of the desktop app, so the row says so while a
 * restart is pending, and "use the default server" deletes the kept choice.
 */
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { createElement as h, useState, type FormEvent, type ReactNode } from 'react'
import { call, errorStyle, muted, row, type CloudStatus, type Translate, failureText } from './api.ts'

interface ServerPickerProps {
  t: Translate
  status: CloudStatus
  apply: (next: CloudStatus) => void
}

export function ServerPicker({ t, status, apply }: ServerPickerProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [address, setAddress] = useState('')
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [verdict, setVerdict] = useState<{ ok: boolean; text: string } | undefined>()
  const [checkedInput, setCheckedInput] = useState<string | undefined>()
  const [checkedBase, setCheckedBase] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()

  const pending = status.pendingBaseURL
  const usable = checkedBase !== undefined && checkedInput === address

  const openPicker = () => {
    setAddress(pending ?? (status.serverOverride ? status.baseURL : ''))
    setVerdict(undefined)
    setCheckedInput(undefined)
    setCheckedBase(undefined)
    setError(undefined)
    setOpen(true)
  }

  const check = async () => {
    setChecking(true)
    setVerdict(undefined)
    setCheckedInput(undefined)
    setCheckedBase(undefined)
    try {
      const out = await call<{ baseURL: string; host: string }>('server/check', { address })
      setCheckedInput(address)
      setCheckedBase(out.baseURL)
      setVerdict({ ok: true, text: t('serverChecked', { host: out.host }) })
    } catch (err: unknown) {
      setVerdict({ ok: false, text: failureText(t, err) })
    } finally {
      setChecking(false)
    }
  }

  const save = async (baseURL: string | null) => {
    if (status.signedIn && !window.confirm(t('serverSignOutConfirm'))) return
    setBusy(true)
    setError(undefined)
    try {
      await call('server/set', { baseURL })
      setOpen(false)
      apply(await call<CloudStatus>('status'))
    } catch (err: unknown) {
      setError(failureText(t, err))
    } finally {
      setBusy(false)
    }
  }

  return h('div', { 'data-testid': 'nm-server-picker' },
    h('div', { style: { ...row, justifyContent: 'space-between' } },
      h('span', null, t('relay', { baseURL: status.baseURL })),
      h(Button, { variant: 'ghost', size: 'sm', onClick: openPicker }, t('serverChange'))),
    pending
      ? h('div', { style: muted }, t('serverPending', { baseURL: pending }), ' ', t('serverSavedRestart'))
      : null,
    open
      ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 } },
          h('div', { style: muted }, t('serverAddressHint')),
          h(Input, { value: address, onChange: (e: FormEvent<HTMLInputElement>) => setAddress(e.currentTarget.value), placeholder: 'https://relay.example.org', autoFocus: true, 'aria-label': t('serverAddress') }),
          h('div', { style: row },
            h(Button, { variant: 'outline', size: 'sm', disabled: checking || busy || !address.trim(), onClick: () => void check() }, checking ? t('serverChecking') : t('serverCheck')),
            h(Button, { variant: 'primary', size: 'sm', disabled: !usable || checking || busy, onClick: () => void save(checkedBase ?? null) }, t('serverUse')),
            status.serverOverride
              ? h(Button, { variant: 'ghost', size: 'sm', disabled: checking || busy, onClick: () => void save(null) }, t('serverDefault'))
              : null,
            h(Button, { variant: 'ghost', size: 'sm', onClick: () => setOpen(false) }, t('cancel'))),
          verdict ? h('div', { style: verdict.ok ? muted : errorStyle }, verdict.text) : null,
          error ? h('div', { style: errorStyle }, error) : null)
      : null)
}
