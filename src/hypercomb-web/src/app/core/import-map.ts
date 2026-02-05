// src/app/core/import-map.ts

export const injectImportMap = (imports: Record<string, string>): void => {
  if (Object.keys(imports).length === 0) return

  const script = document.createElement('script')
  script.type = 'importmap'

  script.textContent = JSON.stringify(
    {
      imports
    },
    null,
    2
  )

  document.head.appendChild(script)
}
