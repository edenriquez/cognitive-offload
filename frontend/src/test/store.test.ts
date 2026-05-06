import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '../store/app-store'

beforeEach(() => {
  useAppStore.setState({
    mode: 'today',
    tasks: [],
    captures: [],
    signals: null,
    toast: null,
    activeFocusTask: null,
    bandwidth: { work: 60, personal: 15, admin: 15, learning: 10 },
  })
})

describe('AppStore', () => {
  it('defaults to today mode', () => {
    expect(useAppStore.getState().mode).toBe('today')
  })

  it('switches modes', () => {
    useAppStore.getState().setMode('focus')
    expect(useAppStore.getState().mode).toBe('focus')
  })

  it('manages tasks', () => {
    const tasks = [
      { id: 't1', day: '2025-05-06', kind: 'must' as const, idx: 1, text: 'Test', done: false },
    ]
    useAppStore.getState().setTasks(tasks)
    expect(useAppStore.getState().tasks).toHaveLength(1)

    useAppStore.getState().toggleTask('t1')
    expect(useAppStore.getState().tasks[0].done).toBe(true)

    useAppStore.getState().toggleTask('t1')
    expect(useAppStore.getState().tasks[0].done).toBe(false)
  })

  it('manages captures', () => {
    const cap = { id: 'c1', text: 'Test', created_at: '2025-05-06T12:00:00Z' }
    useAppStore.getState().addCapture(cap)
    expect(useAppStore.getState().captures).toHaveLength(1)
    expect(useAppStore.getState().captures[0].text).toBe('Test')
  })

  it('manages focus state', () => {
    useAppStore.getState().startFocus('My task')
    expect(useAppStore.getState().activeFocusTask).toBe('My task')
    expect(useAppStore.getState().mode).toBe('focus')

    useAppStore.getState().exitFocus()
    expect(useAppStore.getState().activeFocusTask).toBeNull()
    expect(useAppStore.getState().mode).toBe('today')
  })

  it('manages signals', () => {
    expect(useAppStore.getState().signals).toBeNull()

    const sig = {
      focus_state: 'stable' as const,
      active_threads: 0,
      error_rate: 0,
      error_baseline: 1.0,
      open_loops: 0,
      cutoff_hour: 16.5,
      cognitive_threshold_pct: 0,
      interventions: [],
    }
    useAppStore.getState().setSignals(sig)
    expect(useAppStore.getState().signals).toEqual(sig)
  })

  it('manages toast', () => {
    expect(useAppStore.getState().toast).toBeNull()

    useAppStore.getState().setToast({ msg: 'Test', action: 'OK' })
    expect(useAppStore.getState().toast).toEqual({ msg: 'Test', action: 'OK' })

    useAppStore.getState().setToast(null)
    expect(useAppStore.getState().toast).toBeNull()
  })

  it('manages bandwidth', () => {
    const bw = { work: 50, personal: 20, admin: 20, learning: 10 }
    useAppStore.getState().setBandwidth(bw)
    expect(useAppStore.getState().bandwidth).toEqual(bw)
  })
})
