import { useState } from 'react'
import type { StartupSettings } from '../../../shared/types.ts'
import { Card, CardHeader, ErrorNote, Skeleton, cx } from '../components/ui.tsx'
import { refreshNow, useApi, withLang } from '../lib/api.ts'
import { DEMO } from '../lib/demo.ts'
import { tx } from '../lib/i18n.ts'

type Startup = StartupSettings & { supported: boolean }

export function Settings() {
  const { data, error } = useApi<Startup>(DEMO ? null : '/api/startup')
  return (
    <div className="mx-auto max-w-[760px] space-y-6">
      <header>
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">{tx('Ayarlar', 'Settings')}</h1>
      </header>
      {error ? <ErrorNote message={error} /> : null}
      <Card>
        <CardHeader title={tx('Başlatma', 'Starting')} aside={tx('macOS', 'macOS')} />
        {DEMO ? (
          <p className="px-5 pb-5 text-[13px] text-ink-2">{tx('Bu ayarlar kendi panelinde, bilgisayarında değişir.', 'These settings change on your own dashboard, on your computer.')}</p>
        ) : !data ? (
          <div className="px-5 pb-5">
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !data.supported ? (
          <p className="px-5 pb-5 text-[13px] text-ink-2">{tx("Bu ayarlar şimdilik yalnızca macOS'ta var.", 'These settings are only on macOS for now.')}</p>
        ) : (
          <div className="divide-y divide-line">
            <Toggle
              setting="launcher"
              on={data.launcher}
              title={tx('Uygulamadan tek tıkla başlat', 'Start from the app with one click')}
              text={tx(
                "Wiener Lens kapalıyken uygulamayı açınca çıkan sayfada bir Başlat düğmesi olur; panel arka planda açılır, pencere kendiliğinden yenilenir. Bunun için Library klasörüne küçük bir başlatıcı uygulama kurulur; kapatınca silinir.",
                "When Wiener Lens isn't running, the page the app shows gets a Start button: the dashboard starts in the background and the window reloads on its own. This puts a small launcher app in your Library folder; turning it off removes it.",
              )}
            />
            <Toggle
              setting="autostart"
              on={data.autostart}
              title={tx('Bilgisayar açılınca başlat', 'Start when you log in')}
              text={tx(
                'Oturum açtığında Wiener Lens arka planda başlar; uygulama her zaman doğrudan açılır. Boştayken neredeyse hiç işlemci kullanmaz. macOS bunu Giriş Öğeleri arasında gösterir.',
                'Wiener Lens starts in the background when you log in, so the app always opens straight to the dashboard. It uses almost no CPU while idle. macOS lists it under Login Items.',
              )}
            />
          </div>
        )}
      </Card>
    </div>
  )
}

function Toggle({ setting, on, title, text }: { setting: keyof StartupSettings; on: boolean; title: string; text: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const change = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(withLang('/api/startup'), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ [setting]: !on }) })
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? tx('Kaydedilemedi', "Couldn't save"))
      refreshNow()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex items-start justify-between gap-6 px-5 py-4">
      <div className="min-w-0">
        <p className="text-[14px] font-medium">{title}</p>
        <p className="mt-0.5 max-w-[60ch] text-[13px] text-ink-2">{text}</p>
        {error ? <p className="mt-1 text-[12px] text-danger">{error}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={title}
        disabled={busy}
        onClick={change}
        className={cx(
          'relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-60',
          on ? 'bg-accent' : 'bg-line-strong',
        )}
      >
        <span className={cx('absolute top-0.5 size-5 rounded-full bg-white shadow transition-[left]', on ? 'left-[18px]' : 'left-0.5')} />
      </button>
    </div>
  )
}
