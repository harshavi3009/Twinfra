import { useRef, useState } from 'react'
import { importCsv } from '../api/client.js'

const TEMPLATE = 'ts,entity_id,metric,value\n2026-10-31T10:00:00+05:30,B1,power_kw,182.4\n'

export default function Import() {
  const [file, setFile] = useState(null)
  const [drag, setDrag] = useState(false)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)
  const input = useRef(null)

  const pick = (f) => {
    if (!f) return
    setFile(f)
    setResult(null)
    setDone(null)
    setError('')
    setBusy(true)
    importCsv(f, false)
      .then(setResult)
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false))
  }

  const commit = () => {
    setBusy(true)
    importCsv(file, true)
      .then((r) => setDone(r.inserted ?? r.valid))
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false))
  }

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: 'twinfra_readings_template.csv' })
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Import readings</h1>
        <button type="button" onClick={downloadTemplate} className="text-sm text-accent hover:underline">
          Download template
        </button>
      </div>
      <p className="text-sm text-muted">
        Columns: <span className="font-mono">ts,entity_id,metric,value</span>. Metric is power_kw, water_lpm or occupancy.
        Nothing is saved until you press Import.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          pick(e.dataTransfer.files?.[0])
        }}
        onClick={() => input.current?.click()}
        className={`cursor-pointer rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
          drag ? 'border-accent bg-accent/10' : 'border-line bg-panel hover:border-accent/50'
        }`}
      >
        <div className="text-lg font-semibold">{file ? file.name : 'Drop a CSV here'}</div>
        <div className="mt-1 text-sm text-muted">or click to choose a file</div>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>

      {busy && <p className="text-sm text-muted">Checking file…</p>}
      {error && <p className="rounded-md border border-critical/50 bg-critical/10 p-3 text-sm text-critical">{error}</p>}

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Count label="Rows" value={result.rows} />
            <Count label="Valid" value={result.valid} tone="text-ok" />
            <Count label="Errors" value={result.errors.length} tone={result.errors.length ? 'text-critical' : 'text-ok'} />
          </div>

          {result.errors.length > 0 && (
            <div className="rounded-lg border border-line bg-panel">
              <div className="border-b border-line px-3 py-2 text-xs uppercase tracking-wide text-muted">
                Rows with problems (skipped on import)
              </div>
              <ul className="max-h-48 overflow-auto p-3 font-mono text-xs">
                {result.errors.map((e) => (
                  <li key={e.row} className="py-0.5">
                    <span className="text-muted">row {e.row}:</span> <span className="text-critical">{e.problem}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.preview.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead className="bg-panel-2 text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2">ts</th>
                    <th className="px-3 py-2">entity_id</th>
                    <th className="px-3 py-2">metric</th>
                    <th className="px-3 py-2 text-right">value</th>
                  </tr>
                </thead>
                <tbody>
                  {result.preview.map((r, i) => (
                    <tr key={i} className="border-t border-line bg-panel font-mono text-xs">
                      <td className="px-3 py-1.5">{r.ts}</td>
                      <td className="px-3 py-1.5">{r.entity_id}</td>
                      <td className="px-3 py-1.5">{r.metric}</td>
                      <td className="px-3 py-1.5 text-right">{r.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-line px-3 py-2 text-xs text-muted">First 5 valid rows</div>
            </div>
          )}

          {done !== null ? (
            <p className="rounded-md border border-ok/50 bg-ok/10 p-3 text-sm text-ok">Imported {done} rows.</p>
          ) : (
            <button
              type="button"
              disabled={busy || result.valid === 0}
              onClick={commit}
              className="rounded bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50"
            >
              Import {result.valid} valid rows
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Count({ label, value, tone = 'text-text' }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-3">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-medium ${tone}`}>{value}</div>
    </div>
  )
}
