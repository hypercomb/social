import { describe, expect, it } from 'vitest'
import { cardContacts, contactsIn, knownAddresses } from './contacts.js'

describe('contactsIn — a header field as read', () => {
  it('reads names and addresses, a quoted comma included', () => {
    expect(contactsIn('"Doe, Jane" <Jane@X.com>, bob@y.org; Carol <carol@z.net>', 'inbox')).toEqual([
      { address: 'jane@x.com', name: 'Doe, Jane', source: 'inbox' },
      { address: 'bob@y.org', source: 'inbox' },
      { address: 'carol@z.net', name: 'Carol', source: 'inbox' },
    ])
  })

  it('reads a comment as the name and drops what is not an address', () => {
    expect(contactsIn('dave@w.io (Dave W), undisclosed-recipients:;, not an address', 'sent')).toEqual([
      { address: 'dave@w.io', name: 'Dave W', source: 'sent' },
    ])
  })

  it('reads an empty field as nobody', () => {
    expect(contactsIn('', 'sent')).toEqual([])
  })
})

describe('cardContacts — a contact tile’s cards', () => {
  it('gives every address on a card the card’s name', () => {
    expect(cardContacts([
      { name: 'Leanne', email: 'leanne@hypercomb.com, l@home.org' },
      { name: 'No mail' },
    ])).toEqual([
      { address: 'leanne@hypercomb.com', name: 'Leanne', source: 'contact' },
      { address: 'l@home.org', name: 'Leanne', source: 'contact' },
    ])
  })
})

describe('knownAddresses — one entry per address', () => {
  it('merges by lowercase address and keeps the richest name with its source', async () => {
    const known = await knownAddresses([
      { address: 'JANE@x.com', source: 'inbox' },
      { address: 'jane@x.com', name: 'Jane', source: 'sent' },
      { address: 'Jane Doe <jane@X.com>', source: 'contact' },
      { address: 'jane@x.com', name: 'jane', source: 'inbox' },
    ])
    expect(known).toEqual([{ address: 'jane@x.com', name: 'Jane Doe', source: 'contact' }])
  })

  it('never shows the address as its own name, keeping the first source', async () => {
    expect(await knownAddresses([
      { address: 'bob@y.org', name: 'bob@y.org', source: 'inbox' },
      { address: 'bob@y.org', name: 'BOB@Y.ORG', source: 'sent' },
    ])).toEqual([{ address: 'bob@y.org', source: 'inbox' }])
  })

  it('shows the local part as a name, and a name of its own beats it', async () => {
    expect(await knownAddresses([
      { address: 'bob@y.org', name: 'bob', source: 'inbox' },
    ])).toEqual([{ address: 'bob@y.org', name: 'bob', source: 'inbox' }])
    expect(await knownAddresses([
      { address: 'bob@y.org', name: 'Robert Smith', source: 'contact' },
      { address: 'bob@y.org', name: 'bob', source: 'inbox' },
    ])).toEqual([{ address: 'bob@y.org', name: 'Robert Smith', source: 'contact' }])
  })

  it('sorts named entries by name, then the nameless by address', async () => {
    const known = await knownAddresses([
      { address: 'zed@a.com', source: 'inbox' },
      { address: 'b@b.com', name: 'bea', source: 'sent' },
      { address: 'a@a.com', name: 'Abe', source: 'sent' },
      { address: 'abe2@a.com', name: 'abe', source: 'inbox' },
      { address: 'amy@a.com', source: 'inbox' },
    ])
    expect(known.map(entry => entry.address)).toEqual(['a@a.com', 'abe2@a.com', 'b@b.com', 'amy@a.com', 'zed@a.com'])
  })

  it('takes cards and opened mail in one list', async () => {
    const known = await knownAddresses([
      ...cardContacts([{ name: 'Leanne', email: 'leanne@hypercomb.com' }]),
      ...contactsIn('leanne@hypercomb.com, jaime@hypercomb.com', 'sent'),
    ])
    expect(known).toEqual([
      { address: 'leanne@hypercomb.com', name: 'Leanne', source: 'contact' },
      { address: 'jaime@hypercomb.com', source: 'sent' },
    ])
  })

  it('ignores entries that are not addresses, and an empty call is empty', async () => {
    expect(await knownAddresses([{ address: 'nobody', source: 'inbox' }, { address: '', source: 'sent' }])).toEqual([])
    expect(await knownAddresses()).toEqual([])
  })
})
