import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PaletteStudio } from "../src/components/palette-studio";
import "../src/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

createRoot(root).render(
  <StrictMode>
    <PaletteStudio />
  </StrictMode>,
);
