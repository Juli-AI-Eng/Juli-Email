# Contributing to Inbox MCP

Thank you for your interest in contributing to Inbox MCP! We welcome contributions from the community.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/yourusername/inbox-mcp.git`
3. Install dependencies: `npm install`
4. Create a feature branch: `git checkout -b feature/your-feature-name`

## Development Setup

1. Copy `.env.example` to `.env` and add your OpenAI API key
2. Build the project: `npm run build`
3. Run in development mode: `npm run dev`

## Testing

- Run unit tests: `npm test`
- Run specific tests: `npm test -- path/to/test`
- Run tests in watch mode: `npm test -- --watch`

For E2E tests, you'll need Nylas credentials in `.env.test`.

## Code Style

- We use TypeScript for type safety
- Follow existing code patterns and conventions
- Keep functions focused and testable
- Add JSDoc comments for public APIs

## Submitting Changes

1. Ensure all tests pass
2. Update documentation if needed
3. Commit with clear, descriptive messages
4. Push to your fork
5. Create a Pull Request with:
   - Clear description of changes
   - Any related issue numbers
   - Screenshots if UI changes

## Pull Request Guidelines

- Keep changes focused and atomic
- Include tests for new functionality
- Update README.md if adding features
- Ensure no sensitive data in commits

## Questions?

Feel free to open an issue for questions or discussions!