// hypercomb-web/src/setup/apply-import-map.ts

export const applyImportMap = (
  imports: Record<string, string>
): void => {

  const script = document.createElement('script')
  script.type = 'importmap'
  script.textContent = JSON.stringify({ imports })

  document.head.appendChild(script)
}
