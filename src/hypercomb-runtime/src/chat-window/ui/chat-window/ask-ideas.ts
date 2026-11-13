// ask-ideas.ts — short hints for the empty composer.
//
// One line each. The ghost in the box fades between them. Up and down walk
// the same list while the box is empty.

export const askIdeasOf = (input: { readonly state: string | null; readonly step: string }): readonly string[] => {
  const step = input.step.replace(/\s+/g, ' ').trim().slice(0, 48)
  switch (input.state) {
    case 'you':
      return [
        'Answer what is waiting',
        'Or say continue',
      ]
    case 'budget':
      return [
        'Say continue to carry on',
        'Or a smaller step',
      ]
    case 'gave-up':
      return [
        'Add a model, then continue',
        'Or a smaller step',
      ]
    case 'unattended':
      return [
        'Nothing is listening yet',
      ]
    case 'live':
    case 'quiet':
    case 'carry':
    case 'retry':
    case 'steps':
      return [
        step ? `On: ${step}` : 'The agent is working',
        'What should change',
        'What is left',
      ]
    default:
      return [
        'Ask anything.',
        'A change on this tile',
        'What is still open',
      ]
  }
}
