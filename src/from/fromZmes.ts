import type {
  DLSDistribution,
  DLSDistributionStats,
  DLSMeta,
  DLSSizeDistribution,
  MeasurementVariable,
  MeasurementXY,
  MeasurementXYVariables,
} from 'cheminfo-types';
import { Analysis } from 'common-spectrum';
import type { ZmesParameter } from 'zmes-parser';
import { findParameter, findParameterDeep, parse } from 'zmes-parser';

import type { DLSCheminfo } from '../types.ts';

interface VariableDescriptor {
  /** Parameter name to find in the tree */
  parameterName: string;
  /** Variable key in MeasurementXYVariables (single letter) */
  symbol: keyof MeasurementXYVariables<Float64Array>;
  /** Label for the variable */
  label: string;
  /** Units for the variable */
  units: string;
  /** Whether this variable is dependent (true for y-like data) */
  isDependent: boolean;
}

const VARIABLE_DESCRIPTORS: VariableDescriptor[] = [
  {
    parameterName: 'Sizes',
    symbol: 'x',
    label: 'Particle diameter',
    units: 'nm',
    isDependent: false,
  },
  {
    parameterName: 'Particle Size Intensity Distribution',
    symbol: 'y',
    label: 'Intensity',
    units: '%',
    isDependent: true,
  },
  {
    parameterName: 'Particle Size Volume Distribution (%)',
    symbol: 'v',
    label: 'Volume',
    units: '%',
    isDependent: true,
  },
  {
    parameterName: 'Particle Size Number Distribution',
    symbol: 'n',
    label: 'Number',
    units: '%',
    isDependent: true,
  },
  {
    parameterName: 'Molecular Weights',
    symbol: 'w',
    label: 'Molecular weight',
    units: 'Da',
    isDependent: true,
  },
  {
    parameterName: 'Diffusion Coefficients',
    symbol: 'd',
    label: 'Diffusion coefficient',
    units: 'µm²/s',
    isDependent: true,
  },
  {
    parameterName: 'Relaxation Times',
    symbol: 'r',
    label: 'Relaxation time',
    units: 'µs',
    isDependent: true,
  },
  {
    parameterName: 'Form Factor',
    symbol: 'f',
    label: 'Form factor',
    units: '',
    isDependent: true,
  },
];

const PEAK_CONTAINERS: Array<{
  parameterName: string;
  key: keyof DLSDistribution;
}> = [
  {
    parameterName: 'Particle Size Intensity Distribution Peaks ordered by area',
    key: 'intensity',
  },
  {
    parameterName: 'Particle Size Volume Distribution Peaks ordered by area',
    key: 'volume',
  },
  {
    parameterName: 'Particle Size Number Distribution Peaks ordered by area',
    key: 'number',
  },
];

interface FromZmesOptions {
  /** Unique identifier for the analysis. */
  id?: string;
  /** Human-readable label for the analysis. */
  label?: string;
}

/**
 * Parse a raw .zmes file and create an Analysis.
 *
 * Each record in the file is pushed as a spectrum with multiple variables:
 * - x: Sizes (particle diameter in nm)
 * - y: Particle Size Intensity Distribution (%)
 * - v: Particle Size Volume Distribution (%)
 * - n: Particle Size Number Distribution (%)
 * - w: Molecular Weights (Da)
 * - d: Diffusion Coefficients (µm²/s)
 * - r: Relaxation Times (µs)
 * - f: Form Factor
 *
 * Only variables present in the data are included. A record is skipped
 * if the required x (Sizes) or y (Intensity) variable is missing.
 * @param data - The raw ArrayBuffer contents of a .zmes file
 * @param options - Options for the analysis
 * @returns An Analysis containing one spectrum per record
 */
export async function fromZmes(
  data: ArrayBuffer,
  options: FromZmesOptions = {},
): Promise<Analysis> {
  const analysis = new Analysis(options);
  const zmesFile = await parse(data);

  for (const record of zmesFile.records) {
    const { parameters } = record;
    const variables = buildVariables(parameters);

    if (!variables) {
      continue;
    }

    const meta = extractMeta(parameters);
    const cheminfo = extractCheminfo(parameters);
    if (cheminfo) {
      meta.cheminfo = cheminfo;
    }

    analysis.pushSpectrum(variables, {
      id: record.guid,
      title: extractTitle(parameters),
      dataType: 'DLS measurement',
      meta,
    });

    const spectrum = analysis.spectra.at(-1);
    if (spectrum) {
      spectrum.settings = extractSettings(parameters);
    }
  }

  return analysis;
}

/**
 * Build the MeasurementXYVariables object from the parameter tree.
 *
 * Returns undefined if the required x (Sizes) or y (Intensity) variable is missing.
 * @param parameters - Root parameter node
 * @returns Variables object with x, y, and optional additional variables
 */
function buildVariables(
  parameters: ZmesParameter,
): MeasurementXYVariables<Float64Array> | undefined {
  const found = new Map<string, MeasurementVariable<Float64Array>>();

  for (const descriptor of VARIABLE_DESCRIPTORS) {
    const parameter = findParameterDeep(parameters, descriptor.parameterName);

    if (!(parameter?.value instanceof Float64Array)) {
      continue;
    }

    found.set(descriptor.symbol, {
      symbol: descriptor.symbol,
      label: descriptor.label,
      units: descriptor.units,
      data: parameter.value,
      isDependent: descriptor.isDependent,
    });
  }

  const x = found.get('x');
  const y = found.get('y');

  if (!x || !y) {
    return undefined;
  }

  const variables: MeasurementXYVariables<Float64Array> = { x, y };

  for (const [key, variable] of found) {
    if (key !== 'x' && key !== 'y') {
      const letter = key as keyof MeasurementXYVariables<Float64Array>;
      variables[letter] = variable;
    }
  }

  return variables;
}

/**
 * Extract the sample name from the parameter tree to use as title.
 * @param parameters - Root parameter node
 * @returns The sample name, or an empty string if not found
 */
function extractTitle(parameters: ZmesParameter): string {
  const sampleSettings = findParameter(
    parameters.children ?? [],
    'Sample Settings',
  );
  if (!sampleSettings) return '';
  const sampleName = findParameterDeep(sampleSettings, 'Sample Name');
  return typeof sampleName?.value === 'string' ? sampleName.value : '';
}

/**
 * Extract scalar metadata values from the parameter tree.
 * @param parameters - Root parameter node
 * @returns Record of metadata key-value pairs
 */
function extractMeta(parameters: ZmesParameter): Record<string, unknown> {
  const children = parameters.children ?? [];
  const meta: Record<string, unknown> = {};

  const topLevelFields = [
    { parameterName: 'Operator Name', metaKey: 'operatorName' },
    {
      parameterName: 'Measurement Start Date And Time',
      metaKey: 'measurementStartDateTime',
    },
    {
      parameterName: 'Measurement Completed Date And Time',
      metaKey: 'measurementCompletedDateTime',
    },
    { parameterName: 'Repeat', metaKey: 'repeat' },
    { parameterName: 'Number Of Repeats', metaKey: 'numberOfRepeats' },
    {
      parameterName: 'Pause Between Repeats (s)',
      metaKey: 'pauseBetweenRepeats',
    },
    { parameterName: 'Quality Indicator', metaKey: 'qualityIndicator' },
    { parameterName: 'Result State', metaKey: 'resultState' },
    { parameterName: 'Measurement Type', metaKey: 'measurementType' },
  ];

  for (const field of topLevelFields) {
    const parameter = findParameter(children, field.parameterName);
    if (parameter?.value !== undefined) {
      meta[field.metaKey] = parameter.value;
    }
  }

  // Cumulants results (Z-Average, PDI)
  const deepFields = [
    { parameterName: 'Z-Average (nm)', metaKey: 'zAverage' },
    {
      parameterName: 'Polydispersity Index (PI)',
      metaKey: 'polydispersityIndex',
    },
    {
      parameterName: 'Derived Mean Count Rate (kcps)',
      metaKey: 'derivedMeanCountRate',
    },
  ];

  for (const field of deepFields) {
    const parameter = findParameterDeep(parameters, field.parameterName);
    if (parameter?.value !== undefined) {
      meta[field.metaKey] = parameter.value;
    }
  }

  // Material info (search within Material Settings to avoid Core Characteristics)
  const materialSettings = findParameterDeep(parameters, 'Material Settings');
  if (materialSettings) {
    const materialRI = findParameterDeep(materialSettings, 'Material RI');
    const materialAbsorption = findParameterDeep(
      materialSettings,
      'Material Absorption',
    );
    if (materialRI?.value !== undefined) {
      meta.materialRI = materialRI.value;
    }
    if (materialAbsorption?.value !== undefined) {
      meta.materialAbsorption = materialAbsorption.value;
    }
  }

  // Dispersant info (from Actual Instrument Settings)
  const dispersantViscosity = findParameterDeep(
    parameters,
    'Dispersant Viscosity (cP)',
  );
  const dispersantRI = findParameterDeep(parameters, 'Dispersant RI');
  if (dispersantViscosity?.value !== undefined) {
    meta.dispersantViscosity = dispersantViscosity.value;
  }
  if (dispersantRI?.value !== undefined) {
    meta.dispersantRI = dispersantRI.value;
  }

  return meta;
}

/**
 * Extract instrument settings from the parameter tree.
 * @param parameters - Root parameter node
 * @returns Settings object with instrument info and measurement parameters
 */
function extractSettings(parameters: ZmesParameter): MeasurementXY['settings'] {
  const children = parameters.children ?? [];
  const softwareVersion = findParameter(children, 'Software Version');

  const instrumentSerialNumber = findParameterDeep(
    parameters,
    'Instrument Serial Number',
  );

  const settings: Record<string, unknown> = {
    instrument: {
      manufacturer: 'Malvern Panalytical',
      model: 'Zetasizer',
      ...(typeof instrumentSerialNumber?.value === 'string'
        ? { serialNumber: instrumentSerialNumber.value }
        : {}),
      software: {
        name: 'ZS XPLORER',
        ...(typeof softwareVersion?.value === 'string'
          ? { version: softwareVersion.value }
          : {}),
      },
    },
  };

  // Actual instrument settings
  const instrumentSettingsFields = [
    { parameterName: 'Detector Angle (°)', settingsKey: 'detectorAngle' },
    { parameterName: 'Run Duration (s)', settingsKey: 'runDuration' },
    { parameterName: 'Number Of Runs', settingsKey: 'numberOfRuns' },
    { parameterName: 'Temperature (°C)', settingsKey: 'temperature' },
    { parameterName: 'Attenuator', settingsKey: 'attenuator' },
    { parameterName: 'Attenuation Factor', settingsKey: 'attenuationFactor' },
    {
      parameterName: 'Cuvette Position (mm)',
      settingsKey: 'cuvettePosition',
    },
    {
      parameterName: 'Laser Wavelength (nm)',
      settingsKey: 'laserWavelength',
    },
  ];

  for (const field of instrumentSettingsFields) {
    const parameter = findParameterDeep(parameters, field.parameterName);
    if (typeof parameter?.value === 'number') {
      settings[field.settingsKey] = parameter.value;
    }
  }

  return settings as MeasurementXY['settings'];
}

/**
 * Build the standardized cheminfo metadata for a DLS measurement.
 *
 * Extracts cumulants results (Z-Average, PDI, derived count rate) and
 * peak summaries from the parameter tree into the `DLSCheminfo` structure.
 * @param parameters - Root parameter node
 * @returns DLSCheminfo object, or undefined if no relevant data is found
 */
function extractCheminfo(parameters: ZmesParameter): DLSCheminfo | undefined {
  const dlsMeta: DLSMeta = {};

  const zAverage = findParameterDeep(parameters, 'Z-Average (nm)');
  if (typeof zAverage?.value === 'number') {
    dlsMeta.zAverage = { value: zAverage.value, units: 'nm' };
  }

  const pdi = findParameterDeep(parameters, 'Polydispersity Index (PI)');
  if (typeof pdi?.value === 'number') {
    dlsMeta.polydispersityIndex = pdi.value;
  }

  const countRate = findParameterDeep(
    parameters,
    'Derived Mean Count Rate (kcps)',
  );
  if (typeof countRate?.value === 'number') {
    dlsMeta.derivedMeanCountRate = { value: countRate.value, units: 'kcps' };
  }

  const intercept = findParameterDeep(parameters, 'Intercept');
  if (typeof intercept?.value === 'number') {
    dlsMeta.intercept = intercept.value;
  }

  const distributions = extractDistributions(parameters);
  if (distributions.length > 0) {
    dlsMeta.distributions = distributions;
    const average = computeAverage(distributions);
    if (average) {
      dlsMeta.average = average;
    }
  }

  if (Object.keys(dlsMeta).length === 0) {
    return undefined;
  }

  return { meta: dlsMeta };
}

/**
 * Extract peak summary data from the parameter tree.
 *
 * The Zmes format stores peaks per distribution type in separate containers
 * (e.g., "Particle Size Intensity Distribution Peaks ordered by area").
 * Each container holds "Size Peak" children with Mean, Area, and
 * Standard Deviation. Peaks are merged by index across distribution types
 * into a single DLSDistribution per detected population.
 * @param parameters - Root parameter node
 * @returns Array of distributions, one per detected particle population
 */
function extractDistributions(parameters: ZmesParameter): DLSDistribution[] {
  const distributions: DLSDistribution[] = [];

  for (const container of PEAK_CONTAINERS) {
    const containerParameter = findParameterDeep(
      parameters,
      container.parameterName,
    );
    if (!containerParameter?.children) continue;

    let peakIndex = 0;
    for (const peakNode of containerParameter.children) {
      if (peakNode.name !== 'Size Peak' || !peakNode.children) continue;

      const stats = extractPeakStats(peakNode.children);

      let distribution = distributions[peakIndex];
      if (!distribution) {
        distribution = {};
        distributions[peakIndex] = distribution;
      }
      distribution[container.key] = stats;
      peakIndex++;
    }
  }

  return distributions;
}

/**
 * Compute overall weighted-average distribution stats from per-peak data.
 *
 * For each distribution type (intensity, volume, number), the overall mean
 * is computed as the area-weighted average of peak means.
 * @param distributions - Per-peak distribution data
 * @returns Overall size distribution averages, or undefined if none computed
 */
function computeAverage(
  distributions: DLSDistribution[],
): DLSSizeDistribution | undefined {
  const keys: Array<keyof DLSSizeDistribution> = [
    'intensity',
    'volume',
    'number',
  ];
  const average: DLSSizeDistribution = {};

  for (const key of keys) {
    let weightedSum = 0;
    let totalArea = 0;

    for (const distribution of distributions) {
      const stats = distribution[key];
      if (
        stats?.mean?.value === undefined ||
        stats?.area?.value === undefined
      ) {
        continue;
      }
      weightedSum += stats.mean.value * stats.area.value;
      totalArea += stats.area.value;
    }

    if (totalArea > 0) {
      average[key] = {
        mean: { value: weightedSum / totalArea, units: 'nm' },
      };
    }
  }

  if (Object.keys(average).length === 0) {
    return undefined;
  }

  return average;
}

/**
 * Extract distribution stats from a single peak node's children.
 * @param children - Children of a "Size Peak" parameter node
 * @returns DLSDistributionStats with mean, area, and standardDeviation
 */
function extractPeakStats(children: ZmesParameter[]): DLSDistributionStats {
  const stats: DLSDistributionStats = {};

  for (const property of children) {
    if (typeof property.value !== 'number') continue;

    if (property.name === 'Mean') {
      stats.mean = { value: property.value, units: 'nm' };
    } else if (property.name === 'Area') {
      stats.area = { value: property.value, units: '%' };
    } else if (property.name === 'Standard Deviation') {
      stats.standardDeviation = { value: property.value, units: 'nm' };
    }
  }

  return stats;
}
