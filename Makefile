PYTHON ?= python3
DB ?= transfers.db
INPUT ?= transfer-all-apnic-latest
PORT ?= 8000
DATA_URL := https://ftp.apnic.net/transfers-all/apnic/transfer-all-apnic-latest
NRO_DIR := data/nro

# $(call nro_get,name,url): download to a temp file and replace $(NRO_DIR)/name.json only on success.
nro_get = curl -fsSL -o $(NRO_DIR)/$(1).json.tmp $(2) && mv $(NRO_DIR)/$(1).json.tmp $(NRO_DIR)/$(1).json

.PHONY: help fetch fetch-nro load load-append report report-market summary serve clean

help:
	@echo "Targets:"
	@echo "  fetch        Download the latest APNIC transfer log to $(INPUT)"
	@echo "  fetch-nro    Download the NRO-format JSON transfer logs of all five RIRs to $(NRO_DIR)/"
	@echo "  load         Ingest $(INPUT) into $(DB) (drops and recreates the table)"
	@echo "  load-append  Ingest $(INPUT) into $(DB) without dropping existing rows"
	@echo "  report       Print the standard monthly IPv4 report"
	@echo "  report-market Print the monthly IPv4 report for market (Unused) transfers only"
	@echo "  summary      Print the KPI summary dashboard only"
	@echo "  serve        Launch the local web dashboard on http://127.0.0.1:$(PORT)/"
	@echo "  clean        Remove Python bytecode caches"

fetch:
	curl -o $(INPUT) $(DATA_URL)

fetch-nro:
	mkdir -p $(NRO_DIR)
	$(call nro_get,arin,https://ftp.arin.net/pub/stats/arin/transfers/transfers_latest.json)
	$(call nro_get,ripencc,https://ftp.ripe.net/ripe/stats/transfers/transfers_latest.json)
	$(call nro_get,lacnic,https://ftp.lacnic.net/pub/stats/lacnic/transfers/transfers_latest.json)
	$(call nro_get,afrinic,https://ftp.afrinic.net/stats/afrinic/transfers/transfers_latest.json)
	$(call nro_get,apnic,https://ftp.apnic.net/stats/apnic/transfers/transfers_latest.json)

load:
	$(PYTHON) load_transfers.py --input $(INPUT) --db $(DB)

load-append:
	$(PYTHON) load_transfers.py --input $(INPUT) --db $(DB) --append

report:
	$(PYTHON) report_monthly_ipv4.py --db $(DB)

report-market:
	$(PYTHON) report_monthly_ipv4.py --db $(DB) --market-only

summary:
	$(PYTHON) report_monthly_ipv4.py --db $(DB) --summary-only

serve:
	$(PYTHON) serve.py --port $(PORT)

clean:
	find . -name '__pycache__' -type d -prune -exec rm -rf {} +
	find . -name '*.pyc' -delete
