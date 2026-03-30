import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { fromZetasizer } from '../../index.ts';

const mxdData = readFileSync(
  join(import.meta.dirname, 'data/mxd_zetasizer.txt'),
);
const chcData = readFileSync(
  join(import.meta.dirname, 'data/chc_particleSize.txt'),
);

test('mxd file snapshot', () => {
  const analysis = fromZetasizer(mxdData);

  expect(analysis.spectra).toMatchSnapshot();
});

test('chc file snapshot', () => {
  const analysis = fromZetasizer(chcData);

  expect(analysis.spectra).toMatchSnapshot();
});

test('file produces 3 spectra', () => {
  const analysis = fromZetasizer(mxdData);

  expect(analysis.spectra).toHaveLength(3);
  expect(analysis.spectra[0]?.dataType).toBe('DLS measurement');
});

test('x variable contains Sizes data', () => {
  const analysis = fromZetasizer(mxdData);
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
  const analysis = fromZetasizer(mxdData);
  const spectrum = analysis.spectra[0];

  expect(spectrum).toBeDefined();
  expect(spectrum?.variables.y.data).toBeInstanceOf(Float64Array);
  expect(spectrum?.variables.y.data).toHaveLength(70);
  expect(spectrum?.variables.y.label).toBe('Intensity');
  expect(spectrum?.variables.y.units).toBe('%');
  expect(spectrum?.variables.y.isDependent).toBe(true);
});

test('volume and number variables are present', () => {
  const analysis = fromZetasizer(mxdData);
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
  const analysis = fromZetasizer(mxdData);

  expect(analysis.spectra[0]?.title).toBe('20260916_SiNP_7 1');
  expect(analysis.spectra[1]?.title).toBe('20260916_SiNP_7 2');
});

test('meta contains measurement metadata', () => {
  const analysis = fromZetasizer(mxdData);
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
  const analysis = fromZetasizer(mxdData);
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

test('meta.cheminfo is absent when peak data is not exported', () => {
  const analysis = fromZetasizer(mxdData);
  const meta = analysis.spectra[0]?.meta;

  expect(meta?.cheminfo).toBeUndefined();
});

test('chc file: meta.cheminfo contains cumulants and peak data', () => {
  const analysis = fromZetasizer(chcData);
  const cheminfo = analysis.spectra[0]?.meta?.cheminfo;

  expect(cheminfo).toBeDefined();
  expect(cheminfo?.meta?.zAverage).toStrictEqual({ value: 108, units: 'nm' });
  expect(cheminfo?.meta?.polydispersityIndex).toBe(0.112);
  expect(cheminfo?.meta?.derivedMeanCountRate).toStrictEqual({
    value: 2683,
    units: 'kcps',
  });
  expect(cheminfo?.meta?.intercept).toBe(0.941);

  expect(cheminfo?.meta?.average?.intensity?.mean).toStrictEqual({
    value: 116.1,
    units: 'nm',
  });
  expect(cheminfo?.meta?.average?.volume?.mean).toStrictEqual({
    value: 99.31,
    units: 'nm',
  });
  expect(cheminfo?.meta?.average?.number?.mean).toStrictEqual({
    value: 78.38,
    units: 'nm',
  });

  const distributions = cheminfo?.meta?.distributions;

  expect(distributions).toHaveLength(1);

  const population = distributions[0];

  expect(population?.intensity?.mean).toStrictEqual({
    value: 116.1,
    units: 'nm',
  });
  expect(population?.intensity?.standardDeviation).toStrictEqual({
    value: 32.94,
    units: 'nm',
  });
  expect(population?.volume?.mean).toStrictEqual({
    value: 99.31,
    units: 'nm',
  });
  expect(population?.number?.mean).toStrictEqual({
    value: 78.38,
    units: 'nm',
  });
});

test('settings contain measurement parameters', () => {
  const analysis = fromZetasizer(mxdData);
  const meta = analysis.spectra[0]?.meta;

  expect(meta?.['Temperature (°C)']).toBe(25);
  expect(meta?.['Duration (s)']).toBe(10);
  expect(meta?.['Size Runs']).toBe(10);
  expect(meta?.['Measurement Position (mm)']).toBe(3);
  expect(meta?.Attenuator).toBe(7);
});
