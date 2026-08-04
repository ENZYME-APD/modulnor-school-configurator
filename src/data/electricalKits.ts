export interface ElectricalKit {
  name: string;
  desc: string;
  color: string;
}

/** All available electrical kit types, keyed by their code. */
export const electricalKits: Record<string, ElectricalKit> = {
  S0: { name: "S0 - 4 ENCHUFES",                    desc: "4 POWER PLUGS AND SOCKETS",                                  color: "#3498db" },
  S1: { name: "S1 - 1 x 4 ENCHUFES + 2 DATA",       desc: "1 x 4 POWER PLUGS AND SOCKETS + 2 DATA",                    color: "#2ecc71" },
  S2: { name: "S2 - 2 x 4 ENCHUFES + 2 DATA",       desc: "2 x 4 POWER PLUGS AND SOCKETS + 2 DATA",                    color: "#f1c40f" },
  S3: { name: "S3 - 3 x 4 ENCHUFES + 2 DATA",       desc: "3 x 4 POWER PLUGS AND SOCKETS + 2 DATA",                    color: "#e67e22" },
  S4: { name: "S4 - 4 x 4 ENCHUFES + 2 DATA",       desc: "4 x 4 POWER PLUGS AND SOCKETS + 2 DATA",                    color: "#e74c3c" },
  SP: { name: "SP - 1 ENCHUFE + 1 DATA PROYECTOR",   desc: "1 POWER PLUGS AND SOCKETS + DATA PROJECTOR",                color: "#9b59b6" },
  SC: { name: "SC - CUADRO",                         desc: "ELECTRIC SWITCHBOARD",                                       color: "#e84393" },
  SA: { name: "SA - AIRE + 1 ENCHUFE",               desc: "AIR CONDITIONING + 1 POWER PLUG AND SOCKET",                color: "#00cec9" },
  SK: { name: "SK - CATERING",                       desc: "4x4 SOCKETS + FRIDGE + DISHWASHER + HEATER + TANK 100L",    color: "#fd79a8" },
  ST: { name: "ST - TOMA CORRIENTE",                 desc: "SINGLE POWER OUTLET",                                        color: "#00b894" },
};
