import type {
  MeasurementXY,
  MeasurementXYVariables,
  OneLetter,
} from 'cheminfo-types';
import { Analysis } from 'common-spectrum';
import type { ZetasizerRecord } from 'parse-zetasizer';
import { fromText } from 'parse-zetasizer';

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
 * @param text - The raw text content of a Zetasizer export file
 * @param options - Options for the analysis
 * @returns An Analysis containing one spectrum per measurement
 */
export function fromZetasizer(
  text: string,
  options: FromZetasizerOptions = {},
): Analysis {
  const analysis = new Analysis(options);
  const records = fromText(text);

  for (const record of records) {
    const variables = buildVariables(record);
    if (!variables) continue;

    analysis.pushSpectrum(variables, {
      title: extractTitle(record),
      dataType: 'DLS measurement',
      meta: extractMeta(record),
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
