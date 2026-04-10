import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ImageModelPicker } from './ImageModelPicker'

describe('ImageModelPicker', () => {
  it('renders label and empty-state affordance when no value is selected', () => {
    render(
      <ImageModelPicker
        id="picker-test"
        label="Image model"
        models={[{ id: 'openai/gpt-4o', name: 'GPT-4o' }]}
        value=""
        onChange={() => {}}
      />,
    )
    expect(screen.getByText('Image model')).toBeInTheDocument()
    expect(screen.getByText('Choose a model…')).toBeInTheDocument()
  })
})
