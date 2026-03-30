import type {
  DLSDistribution,
  DLSMeta,
  MeasurementXY,
  MeasurementXYVariables,
  OneLetter,
  TextData,
} from 'cheminfo-types';
import { Analysis } from 'common-spectrum';
import type { ZetasizerRecord } from 'parse-zetasizer';
import { fromText } from 'parse-zetasizer';

import type { DLSCheminfo } from '../types.ts';

/**
 * Mapping from array column names to variable descriptors.
 *
 * The first entry whose name is found in the record becomes x (independent).
 * Subsequent matches become dependent variables using the given symbol.
 */
const VARIABLE_MAPPING: Array<{
  arrayName: string;
  symbol: OneLetter;
  label: string;
  defaultUnits: string;
  isDependent: boolean;
}> = [
  {
    arrayName: 'Sizes',
    symbol: 'x',
    label: 'Particle diameter',
    defaultUnits: 'nm',
    isDependent: false,
  },
  {
    arrayName: 'Intensities',
    symbol: 'y',
    label: 'Intensity',
    defaultUnits: '%',
    isDependent: true,
  },
  {
    arrayName: 'Volumes',
    symbol: 'v',
    label: 'Volume',
    defaultUnits: '%',
    isDependent: true,
  },
  {
    arrayName: 'Numbers',
    symbol: 'n',
    label: 'Number',
    defaultUnits: '%',
    isDependent: true,
  },
];

interface FromZetasizerOptions {
  /** Unique identifier for the analysis. */
  id?: string;
  /** Human-readable label for the analysis. */
  label?: string;
}

/**
 * Parse a Zetasizer tab-separated text export and create an Analysis.
 *
 * The parser dynamically discovers whatever columns the file contains.
 * Known array columns (Sizes, Intensities, Volumes, Numbers) are mapped
 * to standard variable symbols (x, y, v, n). Records missing Sizes or
 * Intensities are skipped.
 * @param data - The raw content of a Zetasizer export file (string, ArrayBuffer, or typed array)
 * @param options - Options for the analysis
 * @returns An Analysis containing one spectrum per measurement
 */
export function fromZetasizer(
  data: TextData,
  options: FromZetasizerOptions = {},
): Analysis {
  const analysis = new Analysis(options);
  const records = fromText(data);

  for (const record of records) {
    const variables = buildVariables(record);
    if (!variables) continue;

    const meta = extractMeta(record);
    const cheminfo = extractCheminfo(record);
    if (cheminfo) {
      meta.cheminfo = cheminfo;
    }

    analysis.pushSpectrum(variables, {
      title: extractTitle(record),
      dataType: 'DLS measurement',
      meta,
    });

    const spectrum = analysis.spectra.at(-1);
    if (spectrum) {
      spectrum.settings = extractSettings(record);
    }
  }

  return analysis;
}

/**
 * Build MeasurementXYVariables from a parsed record.
 *
 * Returns undefined if the required Sizes or Intensities arrays are missing.
 * @param record - Parsed Zetasizer record
 * @returns Variables object, or undefined if required data is missing
 */
function buildVariables(
  record: ZetasizerRecord,
): MeasurementXYVariables<Float64Array> | undefined {
  const sizes = record.arrays.Sizes;
  const intensities = record.arrays.Intensities;

  if (!sizes?.data.length || !intensities?.data.length) {
    return undefined;
  }

  const variables: MeasurementXYVariables<Float64Array> = {
    x: {
      symbol: 'x',
      label: 'Particle diameter',
      units: 'nm',
      data: sizes.data,
      isDependent: false,
    },
    y: {
      symbol: 'y',
      label: 'Intensity',
      units: '%',
      data: intensities.data,
      isDependent: true,
    },
  };

  for (const mapping of VARIABLE_MAPPING) {
    if (mapping.symbol === 'x' || mapping.symbol === 'y') continue;

    const array = record.arrays[mapping.arrayName];
    if (array?.data.length) {
      const letter =
        mapping.symbol as keyof MeasurementXYVariables<Float64Array>;
      variables[letter] = {
        symbol: mapping.symbol,
        label: mapping.label,
        units: mapping.defaultUnits,
        data: array.data,
        isDependent: mapping.isDependent,
      };
    }
  }

  return variables;
}

/**
 * Extract the sample name from the record metadata.
 * @param record - Parsed Zetasizer record
 * @returns The sample name, or empty string if not found
 */
function extractTitle(record: ZetasizerRecord): string {
  const sampleName = record.meta['Sample Name'];
  return typeof sampleName === 'string' ? sampleName : '';
}

/**
 * Extract metadata from a parsed record.
 *
 * All scalar metadata from the record is included. Known numeric fields
 * are mapped to standard keys for consistency with fromZmes output.
 * @param record - Parsed Zetasizer record
 * @returns Record of metadata key-value pairs
 */
function extractMeta(record: ZetasizerRecord): Record<string, unknown> {
  const meta: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record.meta)) {
    if (key === 'Sample Name') continue;
    meta[key] = value;
  }

  return meta;
}

/**
 * Patterns matching Zetasizer peak summary columns.
 *
 * Format A (some exports): "Pk 1 Mean Int (d.nm)", "Pk 2 Area Vol (%)"
 * Format B (common): "Intensity peak 1 (d.nm)", "Intensity Width Peak 1 (d.nm)"
 */
const PEAK_PATTERNS: Array<{
  pattern: RegExp;
  property: 'mean' | 'standardDeviation';
  key: keyof DLSDistribution;
}> = [
  {
    pattern: /^Intensity\s+peak\s+(?<n>\d+)/i,
    property: 'mean',
    key: 'intensity',
  },
  {
    pattern: /^Intensity\s+width\s+peak\s+(?<n>\d+)/i,
    property: 'standardDeviation',
    key: 'intensity',
  },
];

/**
 * Build standardized cheminfo metadata from Zetasizer meta fields.
 *
 * Extracts cumulants results (Z-Average, PdI, intercept, derived count rate)
 * and intensity peak summaries from the record's meta fields.
 * @param record - Parsed Zetasizer record
 * @returns DLSCheminfo object, or undefined if no relevant data is found
 */
function extractCheminfo(record: ZetasizerRecord): DLSCheminfo | undefined {
  const { meta } = record;
  const dlsMeta: DLSMeta = {};

  const zAverage =
    getNumber(meta, 'Z-Ave (d.nm)') ?? getNumber(meta, 'Z-Average (d.nm)');
  if (zAverage !== undefined) {
    dlsMeta.zAverage = { value: zAverage, units: 'nm' };
  }

  const pdi = getNumber(meta, 'PdI');
  if (pdi !== undefined) {
    dlsMeta.polydispersityIndex = pdi;
  }

  const countRate = getNumber(meta, 'Derived Count Rate (kcps)');
  if (countRate !== undefined) {
    dlsMeta.derivedMeanCountRate = { value: countRate, units: 'kcps' };
  }

  const intercept = getNumber(meta, 'Intercept');
  if (intercept !== undefined) {
    dlsMeta.intercept = intercept;
  }

  const distributions = extractDistributions(record);
  if (distributions.length > 0) {
    dlsMeta.distributions = distributions;
  }

  if (Object.keys(dlsMeta).length === 0) {
    return undefined;
  }

  return { meta: dlsMeta };
}

/**
 * Get a numeric value from the record meta, or undefined if not present.
 * @param meta - Record metadata
 * @param key - Meta key to look up
 * @returns The numeric value, or undefined
 */
function getNumber(
  meta: Record<string, boolean | number | string>,
  key: string,
): number | undefined {
  const value = meta[key];
  return typeof value === 'number' ? value : undefined;
}

/**
 * Extract peak summary data from Zetasizer meta fields.
 *
 * Supports "Intensity peak N (d.nm)" and "Intensity Width Peak N (d.nm)"
 * column patterns. Peaks with all-zero values are filtered out.
 * @param record - Parsed Zetasizer record
 * @returns Array of distributions, one per detected particle population
 */
function extractDistributions(record: ZetasizerRecord): DLSDistribution[] {
  const peakMap = new Map<number, DLSDistribution>();

  for (const [key, value] of Object.entries(record.meta)) {
    if (typeof value !== 'number' || value === 0) continue;

    for (const { pattern, property, key: distributionKey } of PEAK_PATTERNS) {
      const match = pattern.exec(key);
      if (!match?.groups?.n) continue;

      const peakNumber = Number(match.groups.n);

      let distribution = peakMap.get(peakNumber);
      if (!distribution) {
        distribution = {};
        peakMap.set(peakNumber, distribution);
      }

      let stats = distribution[distributionKey];
      if (!stats) {
        stats = {};
        distribution[distributionKey] = stats;
      }

      if (property === 'mean') {
        stats.mean = { value, units: 'nm' };
      } else if (property === 'standardDeviation') {
        stats.standardDeviation = { value, units: 'nm' };
      }

      break;
    }
  }

  const sortedKeys = [...peakMap.keys()].toSorted((a, b) => a - b);
  const distributions: DLSDistribution[] = [];
  for (const peakNumber of sortedKeys) {
    const distribution = peakMap.get(peakNumber);
    if (distribution) {
      distributions.push(distribution);
    }
  }

  return distributions;
}

/**
 * Extract instrument settings from a parsed record.
 * @param record - Parsed Zetasizer record
 * @returns Settings object with instrument info and measurement parameters
 */
function extractSettings(record: ZetasizerRecord): MeasurementXY['settings'] {
  const { meta } = record;

  const serialNumber = meta['Serial Number'];
  const softwareVersion = meta['S/W Version'];

  const settings: Record<string, unknown> = {
    instrument: {
      manufacturer: 'Malvern Panalytical',
      model: 'Zetasizer',
      ...(typeof serialNumber === 'string' ? { serialNumber } : {}),
      software: {
        name: 'Zetasizer Nano',
        ...(typeof softwareVersion === 'string' ||
        typeof softwareVersion === 'number'
          ? { version: String(softwareVersion) }
          : {}),
      },
    },
  };

  return settings as MeasurementXY['settings'];
}
