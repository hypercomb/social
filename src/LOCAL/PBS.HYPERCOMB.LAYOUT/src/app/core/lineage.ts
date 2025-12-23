// src/app/core/lineage.ts

export const parseLineage = (url: string): string[] => {
  return url
    .split('?')[0]
    .split('#')[0]
    .split('/')
    .filter(Boolean)
}

export const formatLineage = (segments: string[]): string => {
  return '/' + segments.join('/')
}
