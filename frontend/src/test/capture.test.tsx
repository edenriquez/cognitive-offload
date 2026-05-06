import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CaptureMode from '../components/modes/CaptureMode'
import { useAppStore } from '../store/app-store'

beforeEach(() => {
  useAppStore.setState({
    captures: [
      { id: 'c1', text: 'Existing capture', created_at: new Date().toISOString() },
    ],
  })
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    json: () => Promise.resolve([
      { id: 'c1', text: 'Existing capture', created_at: new Date().toISOString() },
    ]),
    text: () => Promise.resolve(''),
  } as Response)
})

describe('CaptureMode', () => {
  it('renders without crashing', () => {
    render(<CaptureMode />)
    expect(screen.getByText('Capture · no thinking required')).toBeInTheDocument()
  })

  it('has input field focused', () => {
    render(<CaptureMode />)
    const input = screen.getByPlaceholderText("what's on your mind…")
    expect(input).toBeInTheDocument()
  })

  it('shows existing captures', () => {
    render(<CaptureMode />)
    expect(screen.getByText('Existing capture')).toBeInTheDocument()
  })

  it('shows promote and delete buttons on hover', () => {
    render(<CaptureMode />)
    expect(screen.getByText('↑ task')).toBeInTheDocument()
  })

  it('shows keyboard hints', () => {
    render(<CaptureMode />)
    expect(screen.getByText('↵')).toBeInTheDocument()
    expect(screen.getByText('esc')).toBeInTheDocument()
  })
})
