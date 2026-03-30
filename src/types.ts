import type { DLSMeta } from 'cheminfo-types';

/** Wrapper for standardized cheminfo metadata in DLS spectra. */
export interface DLSCheminfo {
  /** Standardized DLS metadata. */
  meta: DLSMeta;
}
