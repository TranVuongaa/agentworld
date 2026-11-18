"use client";
import { useEffect } from "react";
import { App } from "../src/App";
import { applyFont, savedFont } from "../src/theme/fonts";
export default function ClientApp() { useEffect(() => { applyFont(savedFont()); }, []); return <App />; }
