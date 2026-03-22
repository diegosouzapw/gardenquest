// Player model and animation helpers

class Player {
    constructor(scene, name, options = {}) {
        this.scene = scene;
        this.name = name;
        this.group = new THREE.Group();
        this.modelGroundOffset = 0.325;
        this.bodyBaseY = 1.8 - this.modelGroundOffset;
        this.walkTime = 0;
        this.isWalking = false;
        this.speed = Number.isFinite(options.speed) ? options.speed : 8;
        this.direction = new THREE.Vector3();
        this.velocity = new THREE.Vector3();
        this.groundY = Number.isFinite(options.spawnPosition?.y) ? options.spawnPosition.y : 0;
        this.jumpOffset = 0;
        this.jumpVelocity = 0;
        this.jumpGravity = 22;
        this.jumpImpulse = 8.5;
        this.colors = {
            skinColor: options.skinColor ?? 0xf5c6a0,
            shirtColor: options.shirtColor ?? 0x3b82f6,
            pantsColor: options.pantsColor ?? 0x1e3a5f,
            shoeColor: options.shoeColor ?? 0x4a3728,
            hairColor: options.hairColor ?? 0x3d2314,
        };
        this.materials = {};
        this.hitFlashStartedAt = 0;
        this.hitFlashUntil = 0;
        this.equipment = {
            sword: Boolean(options.equipment?.sword),
            bow: Boolean(options.equipment?.bow),
        };
        this.activeActionName = '';
        this.actionAnimationStartedAt = 0;
        this.actionAnimationUntil = 0;

        this._buildModel();
        this.setEquipment(this.equipment);
        const spawnPosition = options.spawnPosition || { x: 0, y: 0, z: 15 };
        this.groundY = spawnPosition.y ?? 0;
        this.group.position.set(
            spawnPosition.x ?? 0,
            this.groundY,
            spawnPosition.z ?? 15
        );
        scene.add(this.group);
    }

    _buildModel() {
        const liftY = (value) => value - this.modelGroundOffset;
        const skinColor = this.colors.skinColor;
        const shirtColor = this.colors.shirtColor;
        const pantsColor = this.colors.pantsColor;
        const shoeColor = this.colors.shoeColor;
        const hairColor = this.colors.hairColor;

        this.materials.body = new THREE.MeshLambertMaterial({ color: shirtColor });
        this.materials.skin = new THREE.MeshLambertMaterial({ color: skinColor });
        this.materials.hair = new THREE.MeshLambertMaterial({ color: hairColor });
        this.materials.legs = new THREE.MeshLambertMaterial({ color: pantsColor });
        this.materials.shoes = new THREE.MeshLambertMaterial({ color: shoeColor });
        this.materials.eye = new THREE.MeshLambertMaterial({ color: 0x222222 });
        this.materials.mouth = new THREE.MeshLambertMaterial({ color: 0xcc6655 });

        const bodyGeo = new THREE.BoxGeometry(0.8, 1.0, 0.5);
        this.body = new THREE.Mesh(bodyGeo, this.materials.body);
        this.body.position.y = this.bodyBaseY;
        this.body.castShadow = true;
        this.group.add(this.body);

        const headGeo = new THREE.BoxGeometry(0.55, 0.6, 0.55);
        this.head = new THREE.Mesh(headGeo, this.materials.skin);
        this.head.position.y = liftY(2.65);
        this.head.castShadow = true;
        this.group.add(this.head);

        const hairGeo = new THREE.BoxGeometry(0.6, 0.25, 0.6);
        this.hair = new THREE.Mesh(hairGeo, this.materials.hair);
        this.hair.position.y = liftY(2.97);
        this.group.add(this.hair);

        const eyeGeo = new THREE.BoxGeometry(0.08, 0.08, 0.05);
        const leftEye = new THREE.Mesh(eyeGeo, this.materials.eye);
        leftEye.position.set(-0.14, liftY(2.7), 0.28);
        this.group.add(leftEye);
        const rightEye = new THREE.Mesh(eyeGeo, this.materials.eye);
        rightEye.position.set(0.14, liftY(2.7), 0.28);
        this.group.add(rightEye);

        const mouthGeo = new THREE.BoxGeometry(0.18, 0.04, 0.05);
        const mouth = new THREE.Mesh(mouthGeo, this.materials.mouth);
        mouth.position.set(0, liftY(2.55), 0.28);
        this.group.add(mouth);

        const armGeo = new THREE.BoxGeometry(0.25, 0.85, 0.25);

        this.leftArmPivot = new THREE.Group();
        this.leftArmPivot.position.set(-0.55, liftY(2.2), 0);
        const leftArm = new THREE.Mesh(armGeo, this.materials.skin);
        leftArm.position.y = -0.4;
        leftArm.castShadow = true;
        this.leftArmPivot.add(leftArm);
        this.group.add(this.leftArmPivot);

        this.rightArmPivot = new THREE.Group();
        this.rightArmPivot.position.set(0.55, liftY(2.2), 0);
        const rightArm = new THREE.Mesh(armGeo, this.materials.skin);
        rightArm.position.y = -0.4;
        rightArm.castShadow = true;
        this.rightArmPivot.add(rightArm);
        this.rightHandAnchor = new THREE.Group();
        this.rightHandAnchor.position.set(0, -0.82, 0.02);
        this.rightArmPivot.add(this.rightHandAnchor);
        this.swordModel = this._buildSwordModel();
        this.rightHandAnchor.add(this.swordModel);
        this.group.add(this.rightArmPivot);

        const legGeo = new THREE.BoxGeometry(0.3, 0.85, 0.3);

        this.leftLegPivot = new THREE.Group();
        this.leftLegPivot.position.set(-0.2, liftY(1.25), 0);
        const leftLeg = new THREE.Mesh(legGeo, this.materials.legs);
        leftLeg.position.y = -0.4;
        leftLeg.castShadow = true;
        this.leftLegPivot.add(leftLeg);
        this.group.add(this.leftLegPivot);

        const shoeGeo = new THREE.BoxGeometry(0.32, 0.15, 0.42);
        const leftShoe = new THREE.Mesh(shoeGeo, this.materials.shoes);
        leftShoe.position.set(0, -0.85, 0.05);
        this.leftLegPivot.add(leftShoe);

        this.rightLegPivot = new THREE.Group();
        this.rightLegPivot.position.set(0.2, liftY(1.25), 0);
        const rightLeg = new THREE.Mesh(legGeo, this.materials.legs);
        rightLeg.position.y = -0.4;
        rightLeg.castShadow = true;
        this.rightLegPivot.add(rightLeg);
        this.group.add(this.rightLegPivot);

        const rightShoe = new THREE.Mesh(shoeGeo, this.materials.shoes);
        rightShoe.position.set(0, -0.85, 0.05);
        this.rightLegPivot.add(rightShoe);
    }

    _buildSwordModel() {
        this.materials.swordBlade = new THREE.MeshLambertMaterial({ color: 0xe2e8f0 });
        this.materials.swordFuller = new THREE.MeshLambertMaterial({ color: 0x94a3b8 });
        this.materials.swordGuard = new THREE.MeshLambertMaterial({ color: 0xfbbf24 });
        this.materials.swordGrip = new THREE.MeshLambertMaterial({ color: 0x4a3728 });
        this.materials.swordPommel = new THREE.MeshLambertMaterial({ color: 0xd97706 });

        const swordGroup = new THREE.Group();

        const blade = new THREE.Mesh(
            new THREE.BoxGeometry(0.1, 1.2, 0.08),
            this.materials.swordBlade
        );
        blade.position.y = 0.78;
        blade.castShadow = true;
        swordGroup.add(blade);

        const fuller = new THREE.Mesh(
            new THREE.BoxGeometry(0.03, 0.76, 0.092),
            this.materials.swordFuller
        );
        fuller.position.y = 0.86;
        fuller.castShadow = true;
        swordGroup.add(fuller);

        const guard = new THREE.Mesh(
            new THREE.BoxGeometry(0.42, 0.08, 0.12),
            this.materials.swordGuard
        );
        guard.position.y = 0.18;
        guard.castShadow = true;
        swordGroup.add(guard);

        const grip = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.32, 0.08),
            this.materials.swordGrip
        );
        grip.position.y = -0.04;
        grip.castShadow = true;
        swordGroup.add(grip);

        const pommel = new THREE.Mesh(
            new THREE.SphereGeometry(0.085, 10, 10),
            this.materials.swordPommel
        );
        pommel.position.y = -0.24;
        pommel.castShadow = true;
        swordGroup.add(pommel);

        swordGroup.position.set(-0.02, 0.02, 0.08);
        swordGroup.rotation.set(0.16, 0.08, -0.06);
        swordGroup.visible = false;
        return swordGroup;
    }

    setColors(nextColors = {}) {
        this.colors = {
            ...this.colors,
            ...nextColors,
        };

        if (this.materials.body) {
            this.materials.body.color.setHex(this.colors.shirtColor);
        }

        if (this.materials.skin) {
            this.materials.skin.color.setHex(this.colors.skinColor);
        }

        if (this.materials.hair) {
            this.materials.hair.color.setHex(this.colors.hairColor);
        }

        if (this.materials.legs) {
            this.materials.legs.color.setHex(this.colors.pantsColor);
        }

        if (this.materials.shoes) {
            this.materials.shoes.color.setHex(this.colors.shoeColor);
        }
    }

    setEquipment(nextEquipment = {}) {
        this.equipment = {
            ...this.equipment,
            sword: Boolean(nextEquipment.sword),
            bow: Boolean(nextEquipment.bow),
        };

        if (this.swordModel) {
            this.swordModel.visible = this.equipment.sword;
        }
    }

    getEquipmentState() {
        return {
            ...this.equipment,
        };
    }

    playAction(actionName, durationMs = 460) {
        if (actionName !== 'attack_sword') {
            return;
        }

        const now = performance.now();
        this.activeActionName = actionName;
        this.actionAnimationStartedAt = now;
        this.actionAnimationUntil = now + Math.max(220, Number(durationMs) || 0);
    }

    isActionPlaying(actionName, now = performance.now()) {
        return this.activeActionName === actionName && now < this.actionAnimationUntil;
    }

    triggerHitFlash(durationMs = 480) {
        const now = performance.now();
        const normalizedDuration = Math.max(180, Number(durationMs) || 0);
        this.hitFlashStartedAt = now;
        this.hitFlashUntil = now + normalizedDuration;
    }

    refreshVisualEffects(now = performance.now()) {
        const isFlashing = now < this.hitFlashUntil;
        const blinkPhase = isFlashing
            ? Math.floor((now - this.hitFlashStartedAt) / 70)
            : 0;
        const emissiveIntensity = isFlashing && blinkPhase % 2 === 0 ? 0.95 : 0;

        Object.values(this.materials).forEach((material) => {
            if (!material?.emissive) {
                return;
            }

            material.emissive.setHex(isFlashing ? 0xffffff : 0x000000);
            material.emissiveIntensity = emissiveIntensity;
        });

        if (!isFlashing && this.hitFlashUntil !== 0) {
            this.hitFlashStartedAt = 0;
            this.hitFlashUntil = 0;
        }
    }

    update(delta, keys, cameraYaw = 0, options = {}) {
        this._updateJump(delta);
        this.direction.set(0, 0, 0);
        const movementSpeed = Number.isFinite(options.speed) ? options.speed : this.speed;
        const inputForward = (keys.w || keys.arrowup ? 1 : 0) - (keys.s || keys.arrowdown ? 1 : 0);
        const inputRight = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);

        if (inputForward !== 0 || inputRight !== 0) {
            const forwardX = -Math.sin(cameraYaw);
            const forwardZ = -Math.cos(cameraYaw);
            const rightX = Math.cos(cameraYaw);
            const rightZ = -Math.sin(cameraYaw);

            this.direction.set(
                rightX * inputRight + forwardX * inputForward,
                0,
                rightZ * inputRight + forwardZ * inputForward
            );
        }

        this.isWalking = this.direction.length() > 0;

        if (this.isWalking) {
            this.direction.normalize();
            const startX = this.group.position.x;
            const startZ = this.group.position.z;

            const targetAngle = Math.atan2(this.direction.x, this.direction.z);
            const currentAngle = this.group.rotation.y;
            let angleDiff = targetAngle - currentAngle;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
            this.group.rotation.y += angleDiff * 8 * delta;

            const nextPosition = {
                x: startX + (this.direction.x * movementSpeed * delta),
                y: this.groundY,
                z: startZ + (this.direction.z * movementSpeed * delta),
            };

            if (typeof options.movementResolver === 'function') {
                const resolvedPosition = options.movementResolver(
                    { x: startX, y: this.groundY, z: startZ },
                    nextPosition
                ) || nextPosition;

                this.groundY = resolvedPosition.y ?? this.groundY;

                this.group.position.set(
                    resolvedPosition.x ?? startX,
                    this.groundY + this.jumpOffset,
                    resolvedPosition.z ?? startZ
                );
            } else {
                const bound = Number.isFinite(options.bound) ? options.bound : 45;
                this.group.position.x = Math.max(-bound, Math.min(bound, nextPosition.x));
                this.group.position.z = Math.max(-bound, Math.min(bound, nextPosition.z));
            }

            const movedX = this.group.position.x - startX;
            const movedZ = this.group.position.z - startZ;
            this.isWalking = Math.sqrt((movedX * movedX) + (movedZ * movedZ)) > 0.0005;
        }

        this._updateAnimation(delta);
    }

    updateRemote(delta, targetPosition, targetRotationY = this.group.rotation.y) {
        this._updateJump(delta);
        if (!targetPosition) {
            this.isWalking = false;
            this._updateAnimation(delta);
            return;
        }

        this.groundY = targetPosition.y ?? 0;
        const dx = targetPosition.x - this.group.position.x;
        const dz = targetPosition.z - this.group.position.z;
        const distance = Math.sqrt((dx * dx) + (dz * dz));

        this.isWalking = distance > 0.04;

        const positionLerp = Math.min(1, delta * 6);
        this.group.position.x += dx * positionLerp;
        this.group.position.z += dz * positionLerp;
        this.group.position.y = this.groundY + this.jumpOffset;

        let angleDiff = targetRotationY - this.group.rotation.y;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        this.group.rotation.y += angleDiff * Math.min(1, delta * 8);

        this._updateAnimation(delta);
    }

    applyAuthorityCorrection(delta, targetPosition, targetRotationY = this.group.rotation.y, options = {}) {
        if (!targetPosition) {
            return;
        }

        const deadzone = Number.isFinite(options.deadzone) ? options.deadzone : 0.05;
        const snapDistance = Number.isFinite(options.snapDistance) ? options.snapDistance : 3.5;
        const positionStrength = Number.isFinite(options.positionStrength) ? options.positionStrength : 6;
        const rotationStrength = Number.isFinite(options.rotationStrength) ? options.rotationStrength : 10;

        const dx = targetPosition.x - this.group.position.x;
        const dz = targetPosition.z - this.group.position.z;
        const distance = Math.sqrt((dx * dx) + (dz * dz));
        this.groundY = targetPosition.y ?? 0;

        if (distance > snapDistance) {
            this.group.position.set(targetPosition.x, this.groundY + this.jumpOffset, targetPosition.z);
        } else if (distance > deadzone) {
            const correctionLerp = Math.min(1, delta * positionStrength);
            this.group.position.x += dx * correctionLerp;
            this.group.position.z += dz * correctionLerp;
        }

        this.group.position.y = this.groundY + this.jumpOffset;

        let angleDiff = targetRotationY - this.group.rotation.y;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        this.group.rotation.y += angleDiff * Math.min(1, delta * rotationStrength);
    }

    setTransform(position, rotationY = this.group.rotation.y) {
        if (position) {
            this.groundY = position.y ?? 0;
            this.group.position.set(position.x ?? 0, this.groundY + this.jumpOffset, position.z ?? 0);
        }

        if (typeof rotationY === 'number') {
            this.group.rotation.y = rotationY;
        }
    }

    jump() {
        if (this.jumpOffset > 0.001 || this.jumpVelocity > 0.001) {
            return false;
        }

        this.jumpVelocity = this.jumpImpulse;
        return true;
    }

    _updateJump(delta) {
        if (this.jumpOffset <= 0 && this.jumpVelocity <= 0) {
            this.jumpOffset = 0;
            this.group.position.y = this.groundY;
            return;
        }

        this.jumpVelocity -= this.jumpGravity * delta;
        this.jumpOffset = Math.max(0, this.jumpOffset + (this.jumpVelocity * delta));

        if (this.jumpOffset === 0 && this.jumpVelocity < 0) {
            this.jumpVelocity = 0;
        }

        this.group.position.y = this.groundY + this.jumpOffset;
    }

    _updateAnimation(delta) {
        const now = performance.now();
        const hasSwordEquipped = Boolean(this.equipment?.sword);
        const isSwordAttackActive = hasSwordEquipped
            && this.activeActionName === 'attack_sword'
            && now < this.actionAnimationUntil;
        const swordHoldBlend = hasSwordEquipped && !isSwordAttackActive ? 1 : 0;
        const swordReadyBlend = hasSwordEquipped && this.isWalking && !isSwordAttackActive ? 1 : 0;

        if (this.isWalking) {
            this.walkTime += delta * 8;
        } else {
            this.walkTime = 0;
        }

        const walkSwing = this.isWalking ? Math.sin(this.walkTime) * 0.6 : 0;
        let leftArmX = this.isWalking ? walkSwing : 0;
        let rightArmX = this.isWalking ? -walkSwing : 0;
        let leftLegX = this.isWalking ? -walkSwing : 0;
        let rightLegX = this.isWalking ? walkSwing : 0;
        let leftArmZ = 0;
        let rightArmZ = 0;
        let bodyY = this.isWalking
            ? this.bodyBaseY + Math.abs(Math.sin(this.walkTime * 2)) * 0.05
            : this.bodyBaseY;

        if (hasSwordEquipped) {
            leftArmX = this.isWalking ? walkSwing * 0.18 : 0.04;
            rightArmX = -0.52 - (0.18 * swordReadyBlend) + (this.isWalking ? (-walkSwing * 0.12) : 0);
            rightArmZ = 0.28 + (0.08 * swordReadyBlend);
        }

        if (isSwordAttackActive) {
            const duration = Math.max(1, this.actionAnimationUntil - this.actionAnimationStartedAt);
            const progress = Math.max(0, Math.min(1, (now - this.actionAnimationStartedAt) / duration));
            const windupProgress = progress < 0.34 ? progress / 0.34 : 1;
            const slashProgress = progress < 0.34 ? 0 : (progress - 0.34) / 0.66;
            const easedSlash = 1 - ((1 - slashProgress) * (1 - slashProgress));

            if (progress < 0.34) {
                rightArmX = -0.3 - (1.18 * windupProgress);
                rightArmZ = -0.24 - (0.34 * windupProgress);
                leftArmX = 0.12 * windupProgress;
            } else {
                rightArmX = -1.48 + (2.2 * easedSlash);
                rightArmZ = -0.58 + (0.68 * easedSlash);
                leftArmX = 0.12 - (0.38 * easedSlash);
            }

            bodyY = this.bodyBaseY + (Math.sin(progress * Math.PI) * 0.08);
        } else if (this.activeActionName === 'attack_sword' && now >= this.actionAnimationUntil) {
            this.activeActionName = '';
            this.actionAnimationStartedAt = 0;
            this.actionAnimationUntil = 0;
        }

        this.leftArmPivot.rotation.x = leftArmX;
        this.leftArmPivot.rotation.y = 0;
        this.leftArmPivot.rotation.z = leftArmZ;
        this.rightArmPivot.rotation.x = rightArmX;
        this.rightArmPivot.rotation.y = 0;
        this.rightArmPivot.rotation.z = rightArmZ;
        this.leftLegPivot.rotation.x = leftLegX;
        this.rightLegPivot.rotation.x = rightLegX;
        this.body.position.y = bodyY;

        if (this.swordModel) {
            const swordSwingOffset = isSwordAttackActive
                ? Math.sin(Math.max(0, Math.min(1, (now - this.actionAnimationStartedAt) / Math.max(1, this.actionAnimationUntil - this.actionAnimationStartedAt))) * Math.PI) * 0.16
                : 0;
            this.swordModel.position.set(
                0.03 - (0.02 * swordReadyBlend),
                0.05 + (0.01 * swordReadyBlend),
                0.24 + (0.16 * swordReadyBlend)
            );
            this.swordModel.rotation.set(
                1.26 + (0.16 * swordHoldBlend) + (0.1 * swordReadyBlend) + swordSwingOffset,
                0.14 + (0.06 * swordReadyBlend),
                0.46 + (0.06 * swordHoldBlend) + (0.04 * swordReadyBlend) - swordSwingOffset * 0.45
            );
        }
    }

    getPosition() {
        return this.group.position;
    }
}
