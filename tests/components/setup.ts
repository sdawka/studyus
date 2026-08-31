// @testing-library/svelte only auto-registers its afterEach cleanup when
// `test.globals` is on, which this project deliberately leaves off. Without a
// cleanup, every rendered component stays in the document and the next file's
// getByRole throws "found multiple elements". Register it once here rather than
// per test file.
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/svelte';

afterEach(() => cleanup());
