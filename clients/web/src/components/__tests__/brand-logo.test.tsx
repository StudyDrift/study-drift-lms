import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BrandLogo } from '../brand-logo'

describe('BrandLogo', () => {
  it('renders accessible logo image with default classes', () => {
    render(<BrandLogo />)
    const img = screen.getByRole('img', { name: 'Lextures' })
    expect(img).toHaveAttribute('src', '/logo-trimmed.svg')
    expect(img.className).toContain('object-contain')
  })

  it('accepts custom className', () => {
    render(<BrandLogo className="h-4 w-4" />)
    const img = screen.getByRole('img', { name: 'Lextures' })
    expect(img.className).toBe('h-4 w-4')
  })
})
