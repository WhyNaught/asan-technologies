# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: Vite with a dependency-light browser frontend in `frontend/`; designed for Vercel deployment.

## Users

The primary users are hackathon judges, curious non-scientists, explorers, and researchers who want to inspect how Earth systems change over time.

## Product Purpose

Asan is an interactive Earth System Intelligence platform for exploring environmental phenomena, selecting bounded demo regions, traveling through time, and understanding trends through charts and clearly labeled synthetic signals.

## Positioning

The product connects phenomenon selection, geographic context, timeline playback, trend analysis, and model transparency in one observatory-like workspace rather than presenting disconnected charts.

## Capabilities and Constraints

- Frontend-only implementation.
- No backend, authentication, database, NASA API calls, model training, or live inference.
- All synthetic fixtures must be clearly labeled as demo data.
- The architecture should allow real NASA observations and model outputs to replace the fixtures later.
- The catalog includes 36 phenomena and three flagship investigation pathways.

## Evidence on Hand

The product brief supplied in the conversation is the source of truth. No real data, customer evidence, brand assets, or paid API credentials were supplied.

## Product Principles

- Make scientific evidence understandable without oversimplifying uncertainty.
- Keep exploration playful, but label simulation, forecast, and scenario states explicitly.
- Prefer a few complete interactions over decorative dead ends.
- Keep the data provider replaceable from the visualization layer.

## Accessibility & Inclusion

The web experience should support keyboard focus, readable contrast, reduced-motion-friendly behavior, responsive layouts, and textual summaries for visual signals.
