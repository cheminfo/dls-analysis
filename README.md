# dls-analysis

[![NPM version](https://img.shields.io/npm/v/dls-analysis.svg)](https://www.npmjs.com/package/dls-analysis)
[![npm download](https://img.shields.io/npm/dm/dls-analysis.svg)](https://www.npmjs.com/package/dls-analysis)
[![test coverage](https://img.shields.io/codecov/c/github/cheminfo/dls-analysis.svg)](https://codecov.io/gh/cheminfo/dls-analysis)
[![license](https://img.shields.io/npm/l/dls-analysis.svg)](https://github.com/cheminfo/dls-analysis/blob/main/LICENSE)

Analysis of Dynamic Light Scattering (DLS) measurements from Malvern Panalytical Zetasizer instruments.

## Installation

```console
npm install dls-analysis
```

## Usage

```js
import { readFileSync } from 'node:fs';

import { fromZmes } from 'dls-analysis';

const arrayBuffer = readFileSync('measurement.zmes').buffer;
const measurements = await fromZmes(arrayBuffer);
```

Each measurement contains the following variables:

| Key | Label                 | Units | Description                          |
| --- | --------------------- | ----- | ------------------------------------ |
| x   | Particle diameter     | nm    | Particle sizes                       |
| y   | Intensity             | %     | Particle Size Intensity Distribution |
| v   | Volume                | %     | Particle Size Volume Distribution    |
| n   | Number                | %     | Particle Size Number Distribution    |
| w   | Molecular weight      | Da    | Molecular Weights                    |
| d   | Diffusion coefficient | µm²/s | Diffusion Coefficients               |
| r   | Relaxation time       | µs    | Relaxation Times                     |
| f   | Form factor           |       | Form Factor                          |

Metadata includes Z-Average, Polydispersity Index, operator name, dispersant and material properties.

Settings include instrument manufacturer, model, serial number, detector angle, laser wavelength, temperature, and more.

## License

[MIT](./LICENSE)
