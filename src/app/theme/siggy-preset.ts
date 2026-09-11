import { definePreset } from "@primeuix/themes";
import Aura from "@primeuix/themes/aura";

/**
 * SIGGY preset: Aura with the Brightside amber as the primary scale.
 * Dark mode follows the `.dark` class (see providePrimeNG options), the same
 * class the SettingsService and Tailwind use — one switch, every layer.
 */
export const SiggyPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: "hsl(40 100% 96%)",
      100: "hsl(39 96% 90%)",
      200: "hsl(38 94% 82%)",
      300: "hsl(37 93% 72%)",
      400: "hsl(36 92% 63%)",
      500: "hsl(35 90% 55%)",
      600: "hsl(32 88% 47%)",
      700: "hsl(28 84% 40%)",
      800: "hsl(26 78% 33%)",
      900: "hsl(24 72% 27%)",
      950: "hsl(22 70% 18%)",
    },
  },
});
