import Imap from "node-imap";

/**
 * Extends the base 'node-imap' configuration to include
 * our internal, human-readable account ID.
 */
export interface IAccountConfig extends Imap.Config {
  id: string;
}