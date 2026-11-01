/**
 * @file
 *
 * Tests for {@link createSettingsFacet}.
 */

import { EditorState } from '@codemirror/state';
import {
  describe,
  expect,
  it
} from 'vitest';

import { createSettingsFacet } from './settings-facet.ts';

interface Settings {
  readonly color: string;
}

describe('createSettingsFacet', () => {
  it('should read the default value when no settings are provided', () => {
    const facet = createSettingsFacet<Settings>({ color: 'red' });
    expect(EditorState.create().facet(facet)).toEqual({ color: 'red' });
  });

  it('should read the last provided settings', () => {
    const facet = createSettingsFacet<Settings>({ color: 'red' });
    const state = EditorState.create({ extensions: [facet.of({ color: 'green' }), facet.of({ color: 'blue' })] });
    expect(state.facet(facet)).toEqual({ color: 'blue' });
  });
});
