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
import { fromText, getArray } from 'parse-zetasizer';

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

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;

    const variables = buildVariables(record);
    if (!variables) continue;

    const meta = extractMeta(record);
    const cheminfo = extractCheminfo(record);
    if (cheminfo) {
      meta.cheminfo = cheminfo;
    }

    analysis.pushSpectrum(variables, {
      id: String(i + 1),
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
  const sizes = getArray(record, 'Sizes');
  const intensities = getArray(record, 'Intensities');

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

    const array = getArray(record, mapping.arrayName);
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
 * All scalar metadata from the record is included except Sample Name (used as title).
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
 * Build standardized cheminfo metadata from a Zetasizer record.
 *
 * Extracts cumulants results (Z-Average, PdI, intercept, derived count rate),
 * overall distribution means, and per-peak distribution summaries.
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

  const average = extractAverage(record);
  if (average) {
    dlsMeta.average = average;
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
 * Meta key patterns for overall distribution means.
 */
const OVERALL_MEAN_KEYS: Array<{
  metaKey: string;
  key: keyof DLSDistribution;
}> = [
  { metaKey: 'Intensity Mean (d.nm)', key: 'intensity' },
  { metaKey: 'Volume Mean (d.nm)', key: 'volume' },
  { metaKey: 'Number Mean (d.nm)', key: 'number' },
];

/**
 * Extract overall distribution means from meta keys.
 *
 * Looks for "Intensity Mean (d.nm)", "Volume Mean (d.nm)", "Number Mean (d.nm)".
 * @param record - Parsed Zetasizer record
 * @returns Overall size distribution averages, or undefined if none found
 */
function extractAverage(record: ZetasizerRecord): DLSDistribution | undefined {
  const average: DLSDistribution = {};

  for (const { metaKey, key } of OVERALL_MEAN_KEYS) {
    const value = getNumber(record.meta, metaKey);
    if (value !== undefined) {
      average[key] = { mean: { value, units: 'nm' } };
    }
  }

  if (Object.keys(average).length === 0) {
    return undefined;
  }

  return average;
}

/**
 * Patterns matching per-peak meta keys from Zetasizer exports.
 *
 * Examples: "Intensity peak 1 (d.nm)", "Intensity Width Peak 1 (d.nm)",
 * "Volume Peak 2 (d.nm)", "Number Width Peak 3 (d.nm)"
 */
const PEAK_MEAN_PATTERN =
  /^(?<dist>Intensity|Volume|Number)\s+peak\s+(?<n>\d+)/i;
const PEAK_WIDTH_PATTERN =
  /^(?<dist>Intensity|Volume|Number)\s+width\s+peak\s+(?<n>\d+)/i;

const META_DISTRIBUTION_MAP: Record<string, keyof DLSDistribution> = {
  intensity: 'intensity',
  volume: 'volume',
  number: 'number',
};

/**
 * Extract per-peak distribution summaries from meta keys.
 *
 * Scans meta for "Intensity peak N", "Intensity Width Peak N", etc.
 * Peaks with zero mean and zero width are filtered out. When only one
 * peak is detected, overall means from arrays (volume, number) are used
 * to enrich the peak.
 * @param record - Parsed Zetasizer record
 * @returns Array of distributions, one per detected particle population
 */
function extractDistributions(record: ZetasizerRecord): DLSDistribution[] {
  const peakMap = new Map<number, DLSDistribution>();

  for (const [key, value] of Object.entries(record.meta)) {
    if (typeof value !== 'number' || value === 0) continue;

    let match = PEAK_MEAN_PATTERN.exec(key);
    if (match?.groups?.dist && match.groups.n) {
      const distributionKey =
        META_DISTRIBUTION_MAP[match.groups.dist.toLowerCase()];
      if (!distributionKey) continue;
      const peakNumber = Number(match.groups.n);

      const distribution = getOrCreateDistribution(peakMap, peakNumber);
      let stats = distribution[distributionKey];
      if (!stats) {
        stats = {};
        distribution[distributionKey] = stats;
      }
      stats.mean = { value, units: 'nm' };
      continue;
    }

    match = PEAK_WIDTH_PATTERN.exec(key);
    if (match?.groups?.dist && match.groups.n) {
      const distributionKey =
        META_DISTRIBUTION_MAP[match.groups.dist.toLowerCase()];
      if (!distributionKey) continue;
      const peakNumber = Number(match.groups.n);

      const distribution = getOrCreateDistribution(peakMap, peakNumber);
      let stats = distribution[distributionKey];
      if (!stats) {
        stats = {};
        distribution[distributionKey] = stats;
      }
      stats.standardDeviation = { value, units: 'nm' };
    }
  }

  // When there's exactly one peak, enrich it with overall means
  // from distributions that don't have per-peak data.
  if (peakMap.size === 1) {
    const onlyPeak = peakMap.values().next().value;
    if (onlyPeak) {
      for (const { metaKey, key } of OVERALL_MEAN_KEYS) {
        if (onlyPeak[key]) continue;
        const value = getNumber(record.meta, metaKey);
        if (value !== undefined) {
          onlyPeak[key] = { mean: { value, units: 'nm' } };
        }
      }
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
 * Get or create a DLSDistribution for a given peak number.
 * @param peakMap - Map of peak numbers to distributions
 * @param peakNumber - Peak number
 * @returns The distribution for the given peak
 */
function getOrCreateDistribution(
  peakMap: Map<number, DLSDistribution>,
  peakNumber: number,
): DLSDistribution {
  let distribution = peakMap.get(peakNumber);
  if (!distribution) {
    distribution = {};
    peakMap.set(peakNumber, distribution);
  }
  return distribution;
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
