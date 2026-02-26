import type {
  MeasurementVariable,
  MeasurementXY,
  MeasurementXYVariables,
} from 'cheminfo-types';
import { Analysis } from 'common-spectrum';
import type { ZmesFile } from 'zmes-parser';
import { parse } from 'zmes-parser';

type ZmesParameter = ZmesFile['records'][number]['parameters'];

/**
 * Find a parameter by name in a flat list of children (direct children only).
 * @param children - List of parameters to search
 * @param name - Name to search for
 * @returns The matching parameter, or undefined if not found
 */
function findParameter(
  children: ZmesParameter[],
  name: string,
): ZmesParameter | undefined {
  return children.find((child) => child.name === name);
}

/**
 * Recursively search for a parameter by name in the parameter tree.
 * @param parameter - Root parameter node to search from
 * @param name - Name to search for
 * @returns The matching parameter, or undefined if not found
 */
function findParameterDeep(
  parameter: ZmesParameter,
  name: string,
): ZmesParameter | undefined {
  if (parameter.name === name) {
    return parameter;
  }
  if (parameter.children) {
    for (const child of parameter.children) {
      const found = findParameterDeep(child, name);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

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

    analysis.pushSpectrum(variables, {
      id: record.guid,
      title: extractTitle(parameters),
      dataType: 'Size measurement',
      meta: extractMeta(parameters),
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
