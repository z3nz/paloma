# Contact: Mackay (Michai Morin)

**Name:** Michai Morin (goes by "Mackay")
**First Meeting:** 2026-03-10
**Introduced by:** Adam (in-person/voice conversation)
**Identity Note:** Adam flagged identity tracking as a safety priority. Spelling confirmed: Michai M-O-R-I-N.

## Project Concept: AWS Agent

Mackay wants an AI agent (or agency of agents) that specializes in AWS infrastructure. Key requirements:

### Core Domains
- **AWS Architecture** — deep expertise across all AWS services
- **Data Pipelines** — design, build, and deploy
- **Databases** — selection, schema design, optimization (RDS, DynamoDB, Redshift, etc.)
- **AWS Certification Knowledge** — access to all AWS cert material and official repositories

### Critical Requirements

1. **Implementation, not advisory.** The agent must not just tell you what to do — it must leverage open-source tools and scripts to actually build and create the user's desired project. Hands-on execution.

2. **Persistent memory (MOST CRUCIAL).** The agent must remember everything across sessions. Mackay specifically called this the most important part.
   - Mentioned MongoDB as an analogy
   - Confirmed vector database / neural network approach
   - The agent needs long-term memory that persists and can be queried semantically

### Architecture Ideas (to explore)
- Vector DB for semantic memory (e.g., Pinecone, Weaviate, Qdrant, pgvector)
- Open-source AWS tools: Terraform, Pulumi, AWS CDK, CloudFormation
- Script repositories for common AWS patterns
- RAG (Retrieval-Augmented Generation) over AWS docs and cert materials
- Agent framework: could be built on Paloma's pillar system, LangChain, CrewAI, or custom

## Status
- **Phase:** Initial concept / first conversation
- **Next steps:** TBD — waiting for Adam's direction on priority and timeline
