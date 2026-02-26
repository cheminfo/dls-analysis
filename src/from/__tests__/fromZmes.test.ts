import { openAsBlob } from 'node:fs';
import { join } from 'node:path';

import type { Analysis } from 'common-spectrum';
import { expect, test } from 'vitest';

import { fromZmes } from '../../index.ts';

const testFilePath = join(import.meta.dirname, 'data/test.zmes');

/**
 * Load and parse the test .zmes file into an Analysis.
 * @returns Analysis from the test file
 */
async function loadAnalysis(): Promise<Analysis> {
  const blob = await openAsBlob(testFilePath);
  const arrayBuffer = await blob.arrayBuffer();
  return fromZmes(arrayBuffer);
}

test('one record produces one spectrum', async () => {
  const analysis = await loadAnalysis();

  expect(analysis.spectra).toHaveLength(2);
  expect(analysis.spectra[0]?.dataType).toBe('Size measurement');
});

test('x variable contains Sizes data', async () => {
  const analysis = await loadAnalysis();
  const spectrum = analysis.spectra[0];

  expect(spectrum).toBeDefined();
  expect(spectrum?.variables.x.data).toBeInstanceOf(Float64Array);
  expect(spectrum?.variables.x.data).toHaveLength(70);
  expect(spectrum?.variables.x.label).toBe('Particle diameter');
  expect(spectrum?.variables.x.units).toBe('nm');
  expect(spectrum?.variables.x.isDependent).toBe(false);
  expect(spectrum?.variables.x.data[0]).toBeCloseTo(0.3, 5);
  expect(spectrum?.variables.x.data[69]).toBeCloseTo(10000, 0);
});

test('y variable contains intensity distribution', async () => {
  const analysis = await loadAnalysis();
  const spectrum = analysis.spectra[0];

  expect(spectrum).toBeDefined();
  expect(spectrum?.variables.y.data).toBeInstanceOf(Float64Array);
  expect(spectrum?.variables.y.data).toHaveLength(70);
  expect(spectrum?.variables.y.label).toBe('Intensity');
  expect(spectrum?.variables.y.units).toBe('%');
  expect(spectrum?.variables.y.isDependent).toBe(true);
});

test('additional variables are present (volume, number, etc.)', async () => {
  const analysis = await loadAnalysis();
  const spectrum = analysis.spectra[0];

  expect(spectrum).toBeDefined();

  // v = volume distribution
  expect(spectrum?.variables.v).toBeDefined();
  expect(spectrum?.variables.v?.label).toBe('Volume');
  expect(spectrum?.variables.v?.units).toBe('%');
  expect(spectrum?.variables.v?.data).toHaveLength(70);

  // n = number distribution
  expect(spectrum?.variables.n).toBeDefined();
  expect(spectrum?.variables.n?.label).toBe('Number');
  expect(spectrum?.variables.n?.data).toHaveLength(70);

  // w = molecular weights
  expect(spectrum?.variables.w).toBeDefined();
  expect(spectrum?.variables.w?.label).toBe('Molecular weight');
  expect(spectrum?.variables.w?.data).toHaveLength(70);

  // d = diffusion coefficients
  expect(spectrum?.variables.d).toBeDefined();
  expect(spectrum?.variables.d?.label).toBe('Diffusion coefficient');
  expect(spectrum?.variables.d?.data).toHaveLength(70);
});

test('title is extracted from sample name', async () => {
  const analysis = await loadAnalysis();

  expect(analysis.spectra[0]?.title).toBe('TEST XX230.A');
});

test('record GUID is used as id', async () => {
  const analysis = await loadAnalysis();

  expect(analysis.spectra[0]?.id).toBe('f5e0a56f-3426-427a-91ca-731e963cc86b');
});

test('meta contains measurement metadata', async () => {
  const analysis = await loadAnalysis();
  const meta = analysis.spectra[0]?.meta;

  expect(meta?.operatorName).toBe('gbf-network');
  expect(meta?.measurementStartDateTime).toBe('2026-02-25T08:33:17.2828726Z');
  expect(meta?.qualityIndicator).toBe('GoodData');
  expect(meta?.resultState).toBe('Completed');
  expect(meta?.repeat).toBe(2);
  expect(meta?.numberOfRepeats).toBe(3);
});

test('meta contains cumulants results', async () => {
  const analysis = await loadAnalysis();
  const meta = analysis.spectra[0]?.meta;

  expect(meta?.zAverage).toBeCloseTo(489.144, 2);
  expect(meta?.polydispersityIndex).toBeCloseTo(0.2645, 3);
});

test('meta contains dispersant and material info', async () => {
  const analysis = await loadAnalysis();
  const meta = analysis.spectra[0]?.meta;

  expect(meta?.dispersantViscosity).toBeCloseTo(2.32, 1);
  expect(meta?.dispersantRI).toBeCloseTo(1.39, 1);
  expect(meta?.materialRI).toBeCloseTo(1.7, 1);
  expect(meta?.materialAbsorption).toBeCloseTo(0.01, 2);
});

test('settings contain instrument info', async () => {
  const analysis = await loadAnalysis();
  const settings = analysis.spectra[0]?.settings;

  expect(settings?.instrument).toStrictEqual({
    manufacturer: 'Malvern Panalytical',
    model: 'Zetasizer',
    serialNumber: '100038577',
    software: {
      name: 'ZS XPLORER',
      version: '4.1.0.82',
    },
  });
});

test('settings contain actual instrument parameters', async () => {
  const analysis = await loadAnalysis();
  const settings = analysis.spectra[0]?.settings;

  expect(settings?.detectorAngle).toBe(173);
  expect(settings?.numberOfRuns).toBe(35);
  expect(settings?.attenuator).toBe(7);
  expect(settings?.laserWavelength).toBe(632.8);
  expect((settings?.temperature as number) ?? 0).toBeCloseTo(25.01, 1);
});
