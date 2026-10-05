FROM python:3.10-slim
WORKDIR /srv/pindou-web
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PINDOU_HOST=0.0.0.0 PINDOU_PORT=8001 PINDOU_RUNTIME_DIR=/tmp/pindou-web-runtime
COPY deploy/cloudbase/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
COPY app ./app
COPY color_standards ./color_standards
COPY run_api.py ./run_api.py
EXPOSE 8001
CMD ["python", "run_api.py"]
