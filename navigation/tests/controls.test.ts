/**
 * Unit tests for the pure input-composition half of the adventure controls.
 *
 * `useAdventureControls` is a React hook and is not rendered here; `composeHeld`
 * is exported precisely so the held-key → AdventureCommand mapping can be tested
 * in the plain Node environment jest.config.js uses.
 *
 * The load-bearing invariant: composeHeld ALWAYS emits both `translation` and
 * `rotation`, including the literal "None". The SDK's `hold(partial)` merges
 * (`{...heldCommand, ...partial}`), so an omitted axis silently keeps its old
 * value — that is what made the camera spin forever after an arrow was released
 * while W stayed down.
 */
import { composeHeld, KEY_TRANSLATION, KEY_ROTATION } from '../../lib/reactor/controls'

describe('composeHeld', () => {
  // ── Both axes are always present ────────────────────────────────────────────

  test('a translation-only key still reports rotation explicitly as None', () => {
    const cmd = composeHeld(new Set(['KeyW']))
    expect(cmd).toEqual({ translation: 'Front', rotation: 'None' })
    expect('rotation' in cmd).toBe(true)
    expect(cmd.rotation).toBe('None')
  })

  test('a rotation-only key still reports translation explicitly as None', () => {
    const cmd = composeHeld(new Set(['ArrowLeft']))
    expect(cmd).toEqual({ translation: 'None', rotation: 'Mouse_Left' })
    expect('translation' in cmd).toBe(true)
    expect(cmd.translation).toBe('None')
  })

  test('no keys held reports both axes as None', () => {
    const cmd = composeHeld(new Set())
    expect(cmd).toEqual({ translation: 'None', rotation: 'None' })
    expect('translation' in cmd).toBe(true)
    expect('rotation' in cmd).toBe(true)
  })

  test('never sets interaction — Space/Shift are driven separately', () => {
    expect('interaction' in composeHeld(new Set(['KeyW', 'ArrowLeft']))).toBe(false)
    expect(composeHeld(new Set()).interaction).toBeUndefined()
  })

  // ── Simultaneous axes ───────────────────────────────────────────────────────

  test('moving and looking at once composes both axes', () => {
    expect(composeHeld(new Set(['KeyW', 'ArrowLeft']))).toEqual({
      translation: 'Front',
      rotation: 'Mouse_Left',
    })
  })

  // ── Regression guard for the runaway-camera bug ─────────────────────────────

  test('releasing an arrow while W is held still clears the rotation axis', () => {
    const held = new Set<string>(['KeyW'])

    held.add('ArrowLeft')
    expect(composeHeld(held).rotation).toBe('Mouse_Left')

    held.delete('ArrowLeft')
    const afterRelease = composeHeld(held)

    // The key must be PRESENT and "None": an absent axis would be merged away by
    // hold({...heldCommand, ...partial}) and the camera would keep spinning.
    expect('rotation' in afterRelease).toBe(true)
    expect(afterRelease.rotation).toBe('None')
    expect(afterRelease).toEqual({ translation: 'Front', rotation: 'None' })
  })

  test('releasing W while an arrow is held still clears the translation axis', () => {
    const held = new Set<string>(['KeyW', 'ArrowLeft'])
    held.delete('KeyW')
    const afterRelease = composeHeld(held)

    expect('translation' in afterRelease).toBe(true)
    expect(afterRelease.translation).toBe('None')
  })

  // ── Cardinal directions ─────────────────────────────────────────────────────

  test.each([
    ['KeyW', 'Front'],
    ['KeyS', 'Back'],
    ['KeyA', 'Left'],
    ['KeyD', 'Right'],
  ])('%s maps to translation %s', (code, translation) => {
    expect(composeHeld(new Set([code]))).toEqual({ translation, rotation: 'None' })
  })

  test.each([
    ['ArrowUp', 'Mouse_Up'],
    ['ArrowDown', 'Mouse_Down'],
    ['ArrowLeft', 'Mouse_Left'],
    ['ArrowRight', 'Mouse_Right'],
  ])('%s maps to rotation %s', (code, rotation) => {
    expect(composeHeld(new Set([code]))).toEqual({ translation: 'None', rotation })
  })

  // ── Diagonals ───────────────────────────────────────────────────────────────

  test.each([
    [['KeyW', 'KeyA'], 'Front_Left'],
    [['KeyW', 'KeyD'], 'Front_Right'],
    [['KeyS', 'KeyA'], 'Back_Left'],
    [['KeyS', 'KeyD'], 'Back_Right'],
  ])('%s composes into the diagonal %s', (codes, translation) => {
    expect(composeHeld(new Set(codes as string[])).translation).toBe(translation)
  })

  test.each([
    [['ArrowUp', 'ArrowLeft'], 'Mouse_Up_Left'],
    [['ArrowUp', 'ArrowRight'], 'Mouse_Up_Right'],
    [['ArrowDown', 'ArrowLeft'], 'Mouse_Down_Left'],
    [['ArrowDown', 'ArrowRight'], 'Mouse_Down_Right'],
  ])('%s composes into the diagonal %s', (codes, rotation) => {
    expect(composeHeld(new Set(codes as string[])).rotation).toBe(rotation)
  })

  test('both diagonals at once', () => {
    expect(composeHeld(new Set(['KeyW', 'KeyA', 'ArrowDown', 'ArrowRight']))).toEqual({
      translation: 'Front_Left',
      rotation: 'Mouse_Down_Right',
    })
  })

  // ── Opposing keys ───────────────────────────────────────────────────────────

  test('opposing keys resolve deterministically rather than cancelling out', () => {
    // Front wins over Back, and Left over Right, per the ternary chain's order.
    expect(composeHeld(new Set(['KeyW', 'KeyS']))).toEqual({ translation: 'Front', rotation: 'None' })
    expect(composeHeld(new Set(['KeyA', 'KeyD']))).toEqual({ translation: 'Left', rotation: 'None' })
    expect(composeHeld(new Set(['ArrowUp', 'ArrowDown'])).rotation).toBe('Mouse_Up')
    expect(composeHeld(new Set(['ArrowLeft', 'ArrowRight'])).rotation).toBe('Mouse_Left')
  })

  test('non-control keys are ignored', () => {
    expect(composeHeld(new Set(['KeyQ', 'Escape', 'Space', 'ShiftLeft']))).toEqual({
      translation: 'None',
      rotation: 'None',
    })
  })

  // ── Key maps ────────────────────────────────────────────────────────────────

  test('the exported key maps cover WASD and the four arrows', () => {
    expect(Object.keys(KEY_TRANSLATION).sort()).toEqual(['KeyA', 'KeyD', 'KeyS', 'KeyW'])
    expect(Object.keys(KEY_ROTATION).sort()).toEqual([
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
    ])
  })

  test('every single mapped key composes to its map entry', () => {
    for (const [code, translation] of Object.entries(KEY_TRANSLATION)) {
      expect(composeHeld(new Set([code])).translation).toBe(translation)
    }
    for (const [code, rotation] of Object.entries(KEY_ROTATION)) {
      expect(composeHeld(new Set([code])).rotation).toBe(rotation)
    }
  })
})
