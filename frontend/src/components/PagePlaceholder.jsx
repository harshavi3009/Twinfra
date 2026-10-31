export default function PagePlaceholder({ title, note }) {
  return (
    <div>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-muted">{note}</p>
    </div>
  )
}
