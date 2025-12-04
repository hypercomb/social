export const JSON_SCHEMA = `{
  type: 'json_schema',
  json_schema: {
    name: 'FlatNamedList',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          detail: { type: 'string' }
        },
        required: ['name', 'detail']
      },
      minItems: 1,
      maxItems: 20
    }
  }
}`
