import { FreeAtHome, AddOn } from '@busch-jaeger/free-at-home';
import { NukiAddonManager } from './nuki-addon-manager';

const freeAtHome = new FreeAtHome();
freeAtHome.activateSignalHandling();

// Hauptfunktion
async function main(): Promise<void> {
  const metaData = AddOn.readMetaData();
  const addOn = new AddOn.AddOn(metaData.id);

  new NukiAddonManager(addOn, freeAtHome);

  console.log("Nuki Addon initialisiert");
}

main().catch((error) => {
  console.error("Kritischer Fehler beim Starten des Addons:", error);
  process.exit(1);
});
