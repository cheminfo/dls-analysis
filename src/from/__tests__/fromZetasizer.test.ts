import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { fromZetasizer } from '../../index.ts';

const testFilePath = join(import.meta.dirname, 'data/zetasizer.txt');
const text = readFileSync(testFilePath, 'latin1');

test('file produces 3 spectra', () => {
  const analysis = fromZetasizer(text);

  expect(analysis.spectra).toHaveLength(3);
  expect(analysis.spectra[0]?.dataType).toBe('Size measurement');
});

test('x variable contains Sizes data', () => {
  const analysis = fromZetasizer(text);
  const spectrum = analysis.spectra[0];

  expect(spectrum).toBeDefined();
  expect(spectrum?.variables.x.data).toBeInstanceOf(Float64Array);
  expect(spectrum?.variables.x.data).toHaveLength(70);
  expect(spectrum?.variables.x.label).toBe('Particle diameter');
  expect(spectrum?.variables.x.units).toBe('nm');
  expect(spectrum?.variables.x.isDependent).toBe(false);
  expect(spectrum?.variables.x.data[0]).toBeCloseTo(0.4, 5);
  expect(spectrum?.variables.x.data[69]).toBeCloseTo(10000, 0);
});

test('y variable contains intensity distribution', () => {
  const analysis = fromZetasizer(text);
  const spectrum = analysis.spectra[0];

  expect(spectrum).toBeDefined();
  expect(spectrum?.variables.y.data).toBeInstanceOf(Float64Array);
  expect(spectrum?.variables.y.data).toHaveLength(70);
  expect(spectrum?.variables.y.label).toBe('Intensity');
  expect(spectrum?.variables.y.units).toBe('%');
  expect(spectrum?.variables.y.isDependent).toBe(true);
});

test('volume and number variables are present', () => {
  const analysis = fromZetasizer(text);
  const spectrum = analysis.spectra[0];

  expect(spectrum).toBeDefined();

  expect(spectrum?.variables.v).toBeDefined();
  expect(spectrum?.variables.v?.label).toBe('Volume');
  expect(spectrum?.variables.v?.units).toBe('%');
  expect(spectrum?.variables.v?.data).toHaveLength(70);

  expect(spectrum?.variables.n).toBeDefined();
  expect(spectrum?.variables.n?.label).toBe('Number');
  expect(spectrum?.variables.n?.data).toHaveLength(70);
});

test('title is extracted from sample name', () => {
  const analysis = fromZetasizer(text);

  expect(analysis.spectra[0]?.title).toBe('20260916_SiNP_7 1');
  expect(analysis.spectra[1]?.title).toBe('20260916_SiNP_7 2');
});

test('meta contains measurement metadata', () => {
  const analysis = fromZetasizer(text);
  const meta = analysis.spectra[0]?.meta;

  expect(meta?.['Measurement Date and Time']).toBe(
    'Wednesday, 25 February 2026 16:02:06',
  );
  expect(meta?.['Record Number']).toBe(20);
  expect(meta?.['Result Origin']).toBe('Nano series');
  expect(meta?.['Viscosity (cP)']).toBe(1.2);
  expect(meta?.['Measurement Status']).toBe('Complete');
});

test('settings contain instrument info', () => {
  const analysis = fromZetasizer(text);
  const settings = analysis.spectra[0]?.settings;

  expect(settings?.instrument).toStrictEqual({
    manufacturer: 'Malvern Panalytical',
    model: 'Zetasizer',
    serialNumber: 'MAL1086580',
    software: {
      name: 'Zetasizer Nano',
      version: '8.02',
    },
  });
});

test('settings contain measurement parameters', () => {
  const analysis = fromZetasizer(text);
  const meta = analysis.spectra[0]?.meta;

  expect(meta?.['Temperature (°C)']).toBe(25);
  expect(meta?.['Duration (s)']).toBe(10);
  expect(meta?.['Size Runs']).toBe(10);
  expect(meta?.['Measurement Position (mm)']).toBe(3);
  expect(meta?.Attenuator).toBe(7);
});
