/**
 * Fork-only: Settings → nanoMuse Cloud, the server row and picker. The phone's "Use a
 * different server" sheet is the model: an address, a Check against the relay's health
 * route, and "Use this server" only once the address on screen is the one that passed.
 * The desktop signs out when the choice is saved, not when the picker opens: the
 * settings page would unmount on sign-out and take the picker with it. A saved choice
 * takes effect on the next start of the desktop app, so the row says so while a
 * restart is pending, and "use the default server" deletes the kept choice.
 *
 * The row, the form and the buttons use the page's own card styles (nm-card, nm-row,
 * nm-field, nm-pill), the same ones the network row next to it uses, so the picker
 * sits on the same rhythm instead of the primitives' own look.
 */
import { createElement as h, useState, type FormEvent, type ReactNode } from 'react'
import { call, type CloudStatus, type Translate, failureText } from './api.ts'
import { bridge } from './bridge.ts'

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
  const restart = bridge()?.restartHost

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

  return h('div', { 'data-testid': 'nm-server-picker', className: 'nm-card' },
    open
      ? h('form', {
          className: 'nm-row',
          style: { flexDirection: 'column', alignItems: 'stretch', gap: 8 },
          onSubmit: (e: FormEvent) => { e.preventDefault(); void check() },
        },
          h('span', { className: 'nm-row-title' }, t('serverAddress')),
          h('span', { className: 'nm-row-sub nm-wrap' }, t('serverAddressHint')),
          h('input', {
            className: 'nm-field',
            type: 'text',
            value: address,
            onChange: (e: FormEvent<HTMLInputElement>) => setAddress(e.currentTarget.value),
            placeholder: 'https://relay.example.org',
            autoFocus: true,
            spellCheck: false,
            autoCapitalize: 'off',
            autoCorrect: 'off',
            'aria-label': t('serverAddress'),
            'aria-invalid': verdict !== undefined && !verdict.ok,
          }),
          verdict ? h('span', { className: verdict.ok ? 'nm-row-sub nm-wrap' : 'nm-row-sub nm-wrap nm-cn-warn', role: verdict.ok ? 'status' : 'alert' }, verdict.text) : null,
          h('div', { style: { display: 'flex', gap: 8 } },
            h('button', { type: 'submit', className: 'nm-pill nm-pill-ghost nm-pill-sm', disabled: checking || busy || !address.trim() }, checking ? t('serverChecking') : t('serverCheck')),
            h('button', { type: 'button', className: 'nm-pill nm-pill-sm', disabled: !usable || checking || busy, onClick: () => void save(checkedBase ?? null) }, t('serverUse')),
            status.serverOverride
              ? h('button', { type: 'button', className: 'nm-pill nm-pill-ghost nm-pill-sm', disabled: checking || busy, onClick: () => void save(null) }, t('serverDefault'))
              : null,
            h('button', { type: 'button', className: 'nm-pill nm-pill-ghost nm-pill-sm', onClick: () => setOpen(false) }, t('cancel'))),
          error ? h('span', { className: 'nm-row-sub nm-wrap nm-cn-warn', role: 'alert' }, error) : null)
      : h('div', { className: 'nm-row' },
          h('div', { className: 'nm-row-main' },
            h('span', { className: 'nm-row-title' }, t('serverTitle')),
            h('span', { className: 'nm-row-sub nm-wrap' }, status.baseURL)),
          h('div', { style: { display: 'flex', gap: 8, flexShrink: 0 } },
            h('button', { type: 'button', className: 'nm-pill nm-pill-ghost nm-pill-sm', onClick: openPicker }, t('serverChange')))),
    pending
      ? h('div', { className: 'nm-row' },
          h('span', { className: 'nm-row-sub nm-wrap', role: 'status' }, t('serverPending', { baseURL: pending }), ' ', t('serverSavedRestart')),
          restart
            ? h('button', { type: 'button', className: 'nm-pill nm-pill-sm', style: { flexShrink: 0 }, onClick: () => void restart() }, t('serverRestart'))
            : null)
      : null)
}
