# Use the official Python 3.12 slim image
FROM python:3.12-slim

# Install uv for fast dependency management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Set working directory
WORKDIR /app

# Copy dependency files
COPY pyproject.toml uv.lock ./

# Install dependencies into a virtual environment
# We use --frozen to ensure the lockfile is respected
RUN uv venv && uv sync --frozen

# Copy the rest of the backend code
COPY . .

# Expose the port (GCP Cloud Run provides $PORT)
ENV PORT=8080
EXPOSE 8080

# Run the application
# We use 'uv run' to execute within the managed virtual environment
CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
