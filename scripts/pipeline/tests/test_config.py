from scripts.pipeline import config


def test_paths_anchor_on_repo_root():
    assert (config.REPO_ROOT / "scripts" / "pipeline").is_dir()
    assert config.OUT_DIR == config.REPO_ROOT / "public" / "tiles" / "buildings" / "vm"


def test_tiles_and_gates():
    assert config.TILES == ["VM01", "VM02", "VM03", "VM04", "VM05", "VM06"]
    assert 0 < config.SKIP_RATE_MAX <= 0.02
    assert config.EPSG_SRC == 2950
    assert config.VM_PACK_SIZE == 2534146301
