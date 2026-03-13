# Deployment Guide

## Recommendation

For the current architecture, the best fit is a single always-on backend instance in a region close to your auction audience. The app keeps active room state in memory, so horizontal scaling is not safe yet. That means:

- use exactly one application instance
- keep it warm / always on
- do not autoscale beyond one instance
- avoid redeploying during the live auction

For a one-off high-stakes auction that you want to manage solo, the recommended order is:

1. Render single web service in `Singapore`
2. Cloud Run single instance in `asia-south1` or `asia-southeast1`
3. A small VPS if you want maximum control and are comfortable managing Linux yourself

## Why Render Is The Default Recommendation

- simpler solo workflow than managing backend infra directly
- native GitHub deployment flow
- good fit for one always-on Node service
- no forced frontend/backend split needed
- easier to reason about than Cloud Run for a single long-lived WebSocket app

## Render Deployment

### Prerequisites

- Push this repo to GitHub
- Have a Render account
- Have your Gemini API key ready

### Steps

1. In Render, create a new `Web Service`.
2. Connect the GitHub repo.
3. Render should detect [`render.yaml`](/Users/nair/Coding%20Projects/ipl_league/render.yaml).
4. Confirm:
   - region: `Singapore`
   - instances: `1`
   - plan: `Starter` or better
5. Add environment variable:
   - `GEMINI_API_KEY`
6. Deploy.

### Post-deploy checks

- Visit `/api/health`
- Open the app URL in two browsers
- Host a room and join from the second browser
- Run a short test auction before the real event

## Cloud Run Deployment

Cloud Run can work for this app only if you force single-instance behavior.

### Required settings

- region: `asia-south1` (Mumbai) or `asia-southeast1` (Singapore)
- minimum instances: `1`
- maximum instances: `1`
- concurrency: keep moderate, for example `40`
- request timeout: `3600` seconds
- CPU: leave on default or allocate more if you expect lots of Gemini calls

### Important caveats

- Cloud Run WebSocket connections are still bounded by the service request timeout.
- Because the room is in memory, any instance restart loses active auction state.
- Running in `us-west1` is a poor fit for India / Dubai / Singapore-heavy audiences.

### What the Cloud Run console actions mean

On the service page:

- `Edit and deploy new revision`
  - Use this when you want to change settings or deploy a new image.
- `Connect to repo`
  - Use this if you want Cloud Run to build and deploy directly from GitHub.
- `Revisions`
  - Shows old and current deployments. Useful for rollback.
- `Logs`
  - Shows runtime errors, failed requests, and startup failures.
- `Metrics`
  - Shows traffic, latency, and resource trends.

### Suggested Cloud Run flow

1. Install and authenticate `gcloud`.
2. Build and push from this repo using the Dockerfile.
3. Deploy to a new service or revision in a better region.
4. Set env vars and scaling exactly as above.
5. Cut traffic to the new revision only after manual testing.

## Event Checklist

- deploy at least one day before the auction
- do one full dry run with 4 to 6 real participants
- keep one person on host controls and one person monitoring logs if possible
- do not redeploy within 2 hours of the event
- keep one backup browser tab signed into the host account
- export the final summary immediately after the auction

## Current Limitation

This deployment guidance assumes the current single-process authoritative backend. If you later move active room state to a durable backend, then autoscaling and multi-instance deployment become safe.
